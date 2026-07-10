import { ClockIcon } from 'lucide-react';

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

const GROUP_LABELS: Record<SetupCheckGroupId, string> = {
	core: 'Core runtime',
	github: 'Git and GitHub',
	linear: 'Linear',
	pi: 'Pi runtime',
	storage: 'Storage',
};

const GROUP_ORDER: readonly SetupCheckGroupId[] = [
	'core',
	'storage',
	'github',
	'pi',
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
	const summary = getSetupSummary(snapshot, error);
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
		<div className='flex flex-col gap-6 pt-4'>
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
									{GROUP_LABELS[group]}
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
					<span>Loading setup diagnostics</span>
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

/** Renders a one-line summary for the snapshot — counts plus blocking notice. */
function getSetupSummary(
	snapshot: SetupDiagnosticsSnapshot | null,
	error?: string | null,
): {
	detail: string;
	title: string;
	tone: 'danger' | 'muted' | 'ok' | 'warning';
} {
	if (error) {
		return {
			detail: 'Setup diagnostics could not be loaded from the main process.',
			title: 'Setup diagnostics unavailable',
			tone: 'danger',
		};
	}

	if (!snapshot) {
		return {
			detail: 'Ensemblr is collecting setup diagnostics.',
			title: 'Checking setup readiness',
			tone: 'muted',
		};
	}

	if (snapshot.status === 'ready') {
		return {
			detail: `${snapshot.successCount} checks passed and ${snapshot.warningCount} warnings remain.`,
			title: 'Core workflows are ready',
			tone: 'ok',
		};
	}

	if (snapshot.status === 'checking') {
		return {
			detail: `${snapshot.blockedCount} required checks are still pending.`,
			title: 'Setup checks are still pending',
			tone: 'warning',
		};
	}

	return {
		detail: `${snapshot.blockedCount} required checks need attention before core workflows open.`,
		title: 'Core workflows are blocked',
		tone: 'danger',
	};
}
