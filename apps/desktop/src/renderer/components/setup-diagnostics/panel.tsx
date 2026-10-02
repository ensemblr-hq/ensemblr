import type { TFunction } from 'i18next';
import { ClockIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useRootDirectoryChange } from '@/renderer/hooks/setup-diagnostics/use-change';
import { useGenericRemediation } from '@/renderer/hooks/setup-diagnostics/use-remediation';
import type {
	SetupCheckGroupId,
	SetupCheckSnapshot,
	SetupDiagnosticsSnapshot,
	SetupRemediationAction,
} from '@/shared/ipc/contracts/setup';

import { SetupDiagnosticsSummary } from './compact';
import { LocalExecutionNotice } from './local-execution-notice';
import { RootDirectoryChangeDialog } from './root-directory/change-dialog';
import { SetupCheckRow } from './setup-check-row';

/** Props for the setup-diagnostics panel. */
interface SetupDiagnosticsPanelProps {
	error?: string | null;
	isRetrying?: boolean;
	onRemediationAction?: (
		action: SetupRemediationAction,
		check: SetupCheckSnapshot,
	) => void | Promise<void>;
	onRetry?: () => void;
	snapshot: SetupDiagnosticsSnapshot | null;
}

/**
 * Names one group heading in the checks list.
 * @param group - The check group being titled.
 * @param t - Translator from the calling component.
 * @returns The heading to paint above that group.
 */
function groupLabel(group: SetupCheckGroupId, t: TFunction): string {
	switch (group) {
		case 'claude':
			return t('common:setup-summary.group.claude', 'Claude Code runtime');
		case 'core':
			return t('common:setup-summary.group.core', 'Core runtime');
		case 'github':
			return t('common:setup-summary.group.github', 'Git and GitHub');
		case 'linear':
			return t('common:setup-summary.group.linear', 'Linear');
		case 'pi':
			return t('common:setup-summary.group.pi', 'Pi runtime');
		case 'storage':
			return t('common:setup-summary.group.storage', 'Storage');
	}
}

const GROUP_ORDER: readonly SetupCheckGroupId[] = [
	'core',
	'storage',
	'github',
	'pi',
	'claude',
	'linear',
];

/** Flat setup-diagnostics panel — status strip, grouped checks, remediation. */
export function SetupDiagnosticsPanel({
	error,
	isRetrying = false,
	onRemediationAction,
	onRetry,
	snapshot,
}: SetupDiagnosticsPanelProps) {
	const { t } = useTranslation();
	const summary = getSetupSummary(snapshot, t, error);
	const { handle: handleGenericRemediation } = useGenericRemediation({
		onRetry,
	});
	const {
		actionError: rootActionError,
		applyResult: rootApplyResult,
		confirm: confirmRootDirectoryChange,
		dismiss: dismissRootDirectoryChange,
		handleRemediationAction,
		isApplying: isApplyingRootChange,
		selection: rootSelection,
	} = useRootDirectoryChange({
		onRemediationAction: onRemediationAction ?? handleGenericRemediation,
		onRetry,
	});

	return (
		<div className='flex flex-col gap-6 py-4'>
			{error ? <DangerNotice>{error}</DangerNotice> : null}
			{rootActionError ? <DangerNotice>{rootActionError}</DangerNotice> : null}

			<SetupDiagnosticsSummary
				detail={summary.detail}
				isRetrying={isRetrying}
				onRetry={onRetry}
				snapshot={snapshot}
				title={summary.title}
				tone={summary.tone}
			/>

			{snapshot ? (
				<div className='flex flex-col gap-6'>
					{GROUP_ORDER.map((group) => {
						const checks = snapshot.checks.filter(
							(check) => check.group === group,
						);

						if (!checks.length) {
							return null;
						}

						return (
							<section className='flex flex-col gap-1' key={group}>
								<h2 className='px-3 font-medium text-muted-foreground text-xs uppercase tracking-wide'>
									{groupLabel(group, t)}
								</h2>
								<div className='flex flex-col divide-y divide-border'>
									{checks.map((check) => (
										<SetupCheckRow
											check={check}
											key={check.id}
											onRemediationAction={handleRemediationAction}
										/>
									))}
								</div>
							</section>
						);
					})}
				</div>
			) : (
				<div className='flex items-center gap-2 px-3 text-muted-foreground text-xs'>
					<ClockIcon aria-hidden='true' className='size-4 shrink-0' />
					<span>
						{t('common:setup-summary.loading', 'Loading setup diagnostics')}
					</span>
				</div>
			)}

			<LocalExecutionNotice />

			<RootDirectoryChangeDialog
				applyResult={rootApplyResult}
				isApplying={isApplyingRootChange}
				onConfirm={() => {
					void confirmRootDirectoryChange();
				}}
				onOpenChange={(open) => {
					if (!open) {
						dismissRootDirectoryChange();
					}
				}}
				selection={rootSelection}
			/>
		</div>
	);
}

/** Inline danger banner for IPC / remediation errors. */
function DangerNotice({ children }: { children: React.ReactNode }) {
	return (
		<div className='rounded-md border border-status-danger/30 bg-status-danger/10 px-3 py-2 text-status-danger text-xs leading-5'>
			{children}
		</div>
	);
}

/**
 * Renders a one-line summary for the snapshot — counts plus blocking notice.
 * @param snapshot - The diagnostics snapshot, or null before it arrives.
 * @param t - Translator from the calling component.
 * @param error - IPC failure that replaces the snapshot entirely.
 * @returns The title, detail, and tone for the summary strip.
 */
function getSetupSummary(
	snapshot: SetupDiagnosticsSnapshot | null,
	t: TFunction,
	error?: string | null,
): {
	detail: string;
	title: string;
	tone: 'danger' | 'muted' | 'ok' | 'warning';
} {
	if (error) {
		return {
			detail: t(
				'common:setup-summary.unavailable.detail',
				'Setup diagnostics could not be loaded from the main process.',
			),
			title: t(
				'common:setup-summary.unavailable.title',
				'Setup diagnostics unavailable',
			),
			tone: 'danger',
		};
	}

	if (!snapshot) {
		return {
			detail: t(
				'common:setup-summary.checking.detail',
				'Ensemblr is collecting setup diagnostics.',
			),
			title: t(
				'common:setup-summary.checking.title',
				'Checking setup readiness',
			),
			tone: 'muted',
		};
	}

	if (snapshot.status === 'ready') {
		return {
			detail: t(
				'common:setup-summary.ready.detail',
				'{{passedChecks}} and {{remainingWarnings}}.',
				{
					passedChecks: t('common:setup-summary.ready.passed-checks', {
						count: snapshot.successCount,
						defaultValue_one: '{{count}} check passed',
						defaultValue_other: '{{count}} checks passed',
					}),
					remainingWarnings: t(
						'common:setup-summary.ready.remaining-warnings',
						{
							count: snapshot.warningCount,
							defaultValue_one: '{{count}} warning remains',
							defaultValue_other: '{{count}} warnings remain',
						},
					),
				},
			),
			title: t('common:setup-summary.ready.title', 'Core workflows are ready'),
			tone: 'ok',
		};
	}

	if (snapshot.status === 'checking') {
		return {
			detail: t('common:setup-summary.pending.detail', {
				count: snapshot.blockedCount,
				defaultValue_one: '{{count}} required check is still pending.',
				defaultValue_other: '{{count}} required checks are still pending.',
			}),
			title: t(
				'common:setup-summary.pending.title',
				'Setup checks are still pending',
			),
			tone: 'warning',
		};
	}

	return {
		detail: t('common:setup-summary.blocked.detail', {
			count: snapshot.blockedCount,
			defaultValue_one:
				'{{count}} required check needs attention before core workflows open.',
			defaultValue_other:
				'{{count}} required checks need attention before core workflows open.',
		}),
		title: t(
			'common:setup-summary.blocked.title',
			'Core workflows are blocked',
		),
		tone: 'danger',
	};
}
