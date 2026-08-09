import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
	agentProviderExecutablePathQuery,
	clearAgentProviderExecutablePath,
	ensemblrQueryKeys,
	selectAgentProviderExecutable,
	setAgentProviderExecutablePath,
} from '@/renderer/api/ensemblr';
import { SettingRow } from '@/renderer/components/settings/setting-row';
import { SettingsCodeValue } from '@/renderer/components/settings/settings-code-value';
import { Button } from '@/renderer/components/ui/button';
import { Input } from '@/renderer/components/ui/input';
import { useDebouncedSettingField } from '@/renderer/hooks/use-debounced-setting-field';
import type { AgentProviderDescriptor } from '@/shared/agent-provider';

/** Debounce window before a typed executable path is persisted to SQLite. */
const PATH_SAVE_DEBOUNCE_MS = 500;

/**
 * Executable override for one agent provider: a debounced path field, the
 * native file picker, a reset to the discovered binary, and the resolved path
 * the runtime will actually spawn. Parameterised by descriptor so Pi and Claude
 * Code share the row instead of each owning a copy.
 */
export function ProviderExecutableRow({
	descriptor,
}: {
	descriptor: AgentProviderDescriptor;
}) {
	const { t } = useTranslation();
	const queryClient = useQueryClient();
	const [pickError, setPickError] = useState<string | null>(null);
	const { data: snapshot } = useQuery(
		agentProviderExecutablePathQuery(descriptor.id),
	);
	const overridePath = snapshot?.overridePath ?? '';

	const invalidate = () => {
		void queryClient.invalidateQueries({
			queryKey: ensemblrQueryKeys.agentProviderExecutablePath(descriptor.id),
		});
		void queryClient.invalidateQueries({
			queryKey: ensemblrQueryKeys.agentProviderReadiness(descriptor.id),
		});
		void queryClient.invalidateQueries({
			queryKey: ensemblrQueryKeys.setupDiagnostics(),
		});
	};

	const persist = (next: string): string => {
		const trimmed = next.trim();
		void (
			trimmed
				? setAgentProviderExecutablePath(descriptor.id, trimmed)
				: clearAgentProviderExecutablePath(descriptor.id)
		).then(invalidate);
		return trimmed;
	};

	const { onChange, value } = useDebouncedSettingField(
		overridePath,
		persist,
		PATH_SAVE_DEBOUNCE_MS,
	);

	const pick = useMutation({
		mutationFn: async () => {
			const result = await selectAgentProviderExecutable(descriptor.id);
			if (result.canceled) return null;
			if (result.error) throw new Error(result.error);
			return result.selectedPath ?? null;
		},
		onError: (error) =>
			setPickError(error instanceof Error ? error.message : String(error)),
		onSuccess: (path) => {
			setPickError(null);
			if (path) {
				onChange(path);
			}
			invalidate();
		},
	});

	return (
		<SettingRow
			control={
				<div className='flex items-center gap-2'>
					<Button
						disabled={pick.isPending}
						onClick={() => pick.mutate()}
						size='sm'
						variant='outline'
					>
						{pick.isPending
							? t('common:actions.picking', 'Picking…')
							: t('common:actions.browse', 'Browse')}
					</Button>
					<Button
						disabled={!value}
						onClick={() => onChange('')}
						size='sm'
						variant='ghost'
					>
						{t(
							'settings:providers.executable.use-discovered',
							'Use discovered {{command}}',
							{ command: descriptor.executableCommand },
						)}
					</Button>
				</div>
			}
			description={t(
				'settings:providers.executable.description',
				'Override the discovered {{command}} binary with a custom one. Leave empty to use the executable found on PATH (recommended).',
				{ command: descriptor.executableCommand },
			)}
			label={t(
				'settings:providers.executable.label',
				'{{provider}} executable path',
				{ provider: descriptor.label },
			)}
			stack
		>
			<div className='space-y-3'>
				<Input
					aria-label={t(
						'settings:providers.executable.label',
						'{{provider}} executable path',
						{ provider: descriptor.label },
					)}
					className='h-7 font-mono text-xs'
					onChange={(event) => onChange(event.target.value)}
					placeholder={`/opt/homebrew/bin/${descriptor.executableCommand}`}
					value={value}
				/>
				<div className='space-y-1'>
					<p className='font-medium text-muted-foreground text-xxs uppercase tracking-widest'>
						{t('settings:providers.executable.resolved', 'Resolved executable')}
					</p>
					<SettingsCodeValue
						source={snapshot?.source ?? null}
						value={
							snapshot?.resolvedPath ??
							t('settings:providers.executable.not-found', 'Not found')
						}
					/>
				</div>
				{pickError ? (
					<p className='text-status-danger text-xs'>{pickError}</p>
				) : null}
			</div>
		</SettingRow>
	);
}
