import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useAtom } from 'jotai';
import { useEffect, useRef, useState } from 'react';

import {
	ensemblrQueryKeys,
	getEnsemblrApi,
	rootDirectoryQuery,
} from '@/renderer/api/ensemblr';
import { SettingRow } from '@/renderer/components/settings/setting-row';
import { SettingsSection } from '@/renderer/components/settings/settings-section';
import { Badge } from '@/renderer/components/ui/badge';
import { Button } from '@/renderer/components/ui/button';
import { Input } from '@/renderer/components/ui/input';
import { Spinner } from '@/renderer/components/ui/spinner';
import { terminalScrollbackMbAtom } from '@/renderer/state/preferences';

/** Debounce window before a typed Pi executable path is persisted to SQLite. */
const PI_PATH_SAVE_DEBOUNCE_MS = 500;

/** Route for the Advanced settings section; renders the advanced-settings panel. */
export const Route = createFileRoute('/_workbench/settings/advanced')({
	component: AdvancedSettings,
});

/** Advanced settings panel for the Ensemblr root directory, a custom Pi executable override, and the terminal scrollback limit. */
function AdvancedSettings() {
	const queryClient = useQueryClient();
	const { data: rootData, isLoading: rootLoading } =
		useQuery(rootDirectoryQuery);
	const [scrollbackMb, setScrollbackMb] = useAtom(terminalScrollbackMbAtom);
	const [pickError, setPickError] = useState<string | null>(null);

	const { data: piData } = useQuery({
		queryFn: () => getEnsemblrApi().getPiExecutablePath(),
		queryKey: ensemblrQueryKeys.piExecutablePath(),
	});
	const [piPath, setPiPath] = useState('');
	const piSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	// Hydrate the input from the resolved SQLite override so it reflects runtime,
	// not a stale local mirror. Re-seeds whenever the resolved override changes.
	const resolvedOverride = piData?.overridePath ?? '';
	useEffect(() => {
		setPiPath(resolvedOverride);
	}, [resolvedOverride]);

	const invalidatePiPath = () => {
		void queryClient.invalidateQueries({
			queryKey: ensemblrQueryKeys.piExecutablePath(),
		});
		void queryClient.invalidateQueries({
			queryKey: ensemblrQueryKeys.setupDiagnostics(),
		});
	};

	const persistPiPath = (value: string) => {
		const trimmed = value.trim();
		void (
			trimmed
				? getEnsemblrApi().setPiExecutablePath({ path: trimmed })
				: getEnsemblrApi().clearPiExecutablePath()
		).then(invalidatePiPath);
	};

	const onPiPathChange = (value: string) => {
		setPiPath(value);
		if (piSaveTimerRef.current) {
			clearTimeout(piSaveTimerRef.current);
		}
		piSaveTimerRef.current = setTimeout(() => {
			piSaveTimerRef.current = null;
			persistPiPath(value);
		}, PI_PATH_SAVE_DEBOUNCE_MS);
	};

	const clearPiPath = () => {
		if (piSaveTimerRef.current) {
			clearTimeout(piSaveTimerRef.current);
			piSaveTimerRef.current = null;
		}
		setPiPath('');
		void getEnsemblrApi().clearPiExecutablePath().then(invalidatePiPath);
	};

	const pickRoot = useMutation({
		mutationFn: async () => {
			const api = getEnsemblrApi();
			const result = await api.selectRootDirectory();
			if (result.canceled) return { applied: false as const };
			if (result.error) throw new Error(result.error);
			if (!result.preview?.canApply) return { applied: false as const };
			const apply = await api.confirmRootDirectoryChange({
				path: result.preview.newRoot.path,
			});
			if (!apply.applied) {
				throw new Error(
					apply.error ?? 'Failed to apply root directory change.',
				);
			}
			return { applied: true as const };
		},
		onError: (error) =>
			setPickError(error instanceof Error ? error.message : String(error)),
		onSuccess: async (result) => {
			setPickError(null);
			if (result.applied) {
				await queryClient.invalidateQueries({
					queryKey: ensemblrQueryKeys.rootDirectory(),
				});
			}
		},
	});

	const pickPi = useMutation({
		mutationFn: async () => {
			const result = await getEnsemblrApi().selectPiExecutable();
			if (result.canceled) return null;
			if (result.error) throw new Error(result.error);
			return result.selectedPath ?? null;
		},
		onSuccess: (path) => {
			if (path) setPiPath(path);
			invalidatePiPath();
		},
	});

	const rootStatus = rootData?.status ?? 'ok';

	return (
		<SettingsSection
			description='Root directory, Pi executable override, and terminal-scrollback limits. SSH key for cloud workspaces is deferred (ADR 0020).'
			title='Advanced'
		>
			<SettingRow
				control={
					<Button
						disabled={pickRoot.isPending}
						onClick={() => pickRoot.mutate()}
						size='sm'
						variant='outline'
					>
						{pickRoot.isPending ? 'Picking…' : 'Browse'}
					</Button>
				}
				description='Where Ensemblr stores repositories and workspaces. This should be an empty directory you do not modify directly. Changing this will reconcile your repository list against the new root.'
				label={
					<span className='flex items-center gap-2'>
						Ensemblr root directory
						{rootStatus !== 'ok' ? (
							<Badge
								variant={rootStatus === 'error' ? 'destructive' : 'outline'}
							>
								{rootStatus}
							</Badge>
						) : null}
					</span>
				}
				stack
			>
				{rootLoading ? (
					<div className='mt-2 flex items-center gap-2 text-muted-foreground text-xs'>
						<Spinner className='size-3' /> Reading root…
					</div>
				) : (
					<div className='mt-2 space-y-1'>
						<code className='block truncate rounded-md bg-muted/40 px-3 py-2 font-mono text-xs'>
							{rootData?.path ?? 'Not configured'}
						</code>
						{rootData?.source ? (
							<p className='text-[0.625rem] text-muted-foreground'>
								source: {rootData.source}
							</p>
						) : null}
					</div>
				)}
				{pickError ? (
					<p className='mt-2 text-status-danger text-xs'>{pickError}</p>
				) : null}
			</SettingRow>

			<SettingRow
				control={
					<div className='flex items-center gap-2'>
						<Button
							disabled={pickPi.isPending}
							onClick={() => pickPi.mutate()}
							size='sm'
							variant='outline'
						>
							{pickPi.isPending ? 'Picking…' : 'Browse'}
						</Button>
						<Button
							disabled={!piPath}
							onClick={clearPiPath}
							size='sm'
							variant='ghost'
						>
							Use bundled Pi
						</Button>
					</div>
				}
				description='Override the bundled Pi executable with a custom one. Leave empty to use the discovered system Pi (recommended).'
				label='Pi executable path'
				stack
			>
				<Input
					aria-label='Pi executable path'
					className='mt-2 h-8 font-mono text-xs'
					onChange={(e) => onPiPathChange(e.target.value)}
					placeholder='/opt/homebrew/bin/pi'
					value={piPath}
				/>
			</SettingRow>

			<SettingRow
				control={
					<div className='flex items-center gap-2 text-xs'>
						<Input
							aria-label='Terminal scrollback limit in megabytes'
							className='h-8 w-20 text-right font-mono'
							max={200}
							min={1}
							onChange={(e) =>
								setScrollbackMb(Math.max(1, Number(e.target.value) || 1))
							}
							type='number'
							value={scrollbackMb}
						/>
						<span className='text-muted-foreground'>MB</span>
					</div>
				}
				description='Maximum size of each terminal pane scrollback buffer. Larger values keep more history at the cost of memory.'
				label='Terminal scrollback limit'
			/>

			<SettingRow
				control={<Badge variant='outline'>Deferred</Badge>}
				description='SSH private key for cloud workspaces. Cloud workspaces are deferred for v1 (ADR 0020).'
				label='SSH private key path'
			/>
		</SettingsSection>
	);
}
