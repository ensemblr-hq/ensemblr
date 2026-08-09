import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { CheckIcon, ClipboardCheckIcon, RotateCcwIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
	ensemblrQueryKeys,
	setupDiagnosticsQuery,
	updateAppSettings,
} from '@/renderer/api/ensemblr';
import { SettingRow } from '@/renderer/components/settings/setting-row';
import { SettingsSection } from '@/renderer/components/settings/settings-section';
import { SetupDiagnosticsPanel } from '@/renderer/components/setup-diagnostics';
import { Button } from '@/renderer/components/ui/button';
import { sanitizeDiagnosticsBundle } from '@/renderer/lib/diagnostics-bundle';

/** Route for the Diagnostics settings section; renders the setup-diagnostics panel with a copy-bundle action. */
export const Route = createFileRoute('/_workbench/settings/diagnostics')({
	component: DiagnosticsRoute,
});

/**
 * Settings → Diagnostics. Renders the full setup gate so the user can resolve
 * blocked checks without leaving the workbench, a "Copy diagnostics bundle"
 * action that sanitizes secrets before placing JSON on the clipboard, and a
 * re-run of the first-run wizard — otherwise reachable only by hand-clearing
 * `onboarding.completedAt` in `config.json`.
 */
function DiagnosticsRoute() {
	const { t } = useTranslation();
	const queryClient = useQueryClient();
	const { data: snapshot, error: queryError } = useQuery(setupDiagnosticsQuery);
	const [copied, setCopied] = useState(false);
	const [isManualRetrying, setIsManualRetrying] = useState(false);
	const [isRerunning, setIsRerunning] = useState(false);
	const navigate = useNavigate();

	const onRerunOnboarding = async () => {
		setIsRerunning(true);
		try {
			await updateAppSettings({ onboarding: { completedAt: null } });
			await navigate({ to: '/onboarding' });
		} catch {
			setIsRerunning(false);
		}
	};

	const onRetry = async () => {
		setIsManualRetrying(true);
		try {
			await queryClient.refetchQueries({
				queryKey: ensemblrQueryKeys.setupDiagnostics(),
			});
		} finally {
			setIsManualRetrying(false);
		}
	};

	const onCopyBundle = async () => {
		if (!snapshot) return;
		try {
			await navigator.clipboard.writeText(
				JSON.stringify(sanitizeDiagnosticsBundle(snapshot), null, 2),
			);
			setCopied(true);
			window.setTimeout(() => setCopied(false), 1800);
		} catch {
			setCopied(false);
		}
	};

	return (
		<SettingsSection
			action={
				<Button
					disabled={!snapshot}
					onClick={onCopyBundle}
					size='sm'
					variant='secondary'
				>
					{copied ? (
						<CheckIcon aria-hidden='true' className='size-4' />
					) : (
						<ClipboardCheckIcon aria-hidden='true' className='size-4' />
					)}
					{copied
						? t('common:actions.copied', 'Copied')
						: t('settings:diagnostics.copy-bundle', 'Copy diagnostics bundle')}
				</Button>
			}
			description={t(
				'settings:diagnostics.description',
				'Setup gate checks for Pi, git, GitHub, Linear, and the Ensemblr runtime. The diagnostics bundle redacts secrets, account ids, and full paths before going to the clipboard.',
			)}
			title={t('settings:diagnostics.title', 'Diagnostics')}
		>
			<SetupDiagnosticsPanel
				error={queryError instanceof Error ? queryError.message : null}
				isRetrying={isManualRetrying}
				onRetry={onRetry}
				snapshot={snapshot ?? null}
			/>

			<SettingRow
				control={
					<Button
						disabled={isRerunning}
						onClick={() => void onRerunOnboarding()}
						size='sm'
						variant='secondary'
					>
						<RotateCcwIcon aria-hidden='true' className='size-4' />
						{t('settings:diagnostics.rerun-onboarding.action', 'Re-run wizard')}
					</Button>
				}
				description={t(
					'settings:diagnostics.rerun-onboarding.description',
					'Reopen the first-run setup wizard. Nothing already configured is undone — the wizard re-probes every check and walks you through whatever is still unresolved.',
				)}
				label={t('settings:diagnostics.rerun-onboarding.label', 'Setup wizard')}
			/>
		</SettingsSection>
	);
}
