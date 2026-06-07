import { ClockIcon, RefreshCwIcon } from 'lucide-react';
import { useState } from 'react';

import { ShellPanel } from '@/renderer/components/shell-panel';
import { StatusBadge } from '@/renderer/components/status-badge';
import { Button } from '@/renderer/components/ui/button';
import {
	isPiExecutablePickerAction,
	isRootDirectoryPickerAction,
} from '@/renderer/lib/setup-diagnostics';
import { cn } from '@/renderer/lib/utils';
import type {
	RootDirectoryChangeApplyResult,
	RootDirectorySelectionResult,
	SetupCheckGroupId,
	SetupCheckSnapshot,
	SetupDiagnosticsSnapshot,
	SetupRemediationAction,
} from '@/shared/ipc';

import { SetupDiagnosticsCompact } from './compact';
import { LocalExecutionNotice } from './local-execution-notice';
import { RootDirectoryChangeDialog } from './root-directory-change-dialog';
import { SetupCheckRow } from './setup-check-row';

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

/** Full setup-diagnostics panel — groups checks, surfaces remediation actions. */
export function SetupDiagnosticsPanel({
	error,
	isRetrying = false,
	onRemediationAction,
	onRetry,
	snapshot,
}: SetupDiagnosticsPanelProps) {
	const summary = getSetupSummary(snapshot, error);
	const [rootSelection, setRootSelection] =
		useState<RootDirectorySelectionResult | null>(null);
	const [rootApplyResult, setRootApplyResult] =
		useState<RootDirectoryChangeApplyResult | null>(null);
	const [rootActionError, setRootActionError] = useState<string | null>(null);
	const [isApplyingRootChange, setIsApplyingRootChange] = useState(false);
	const handleRemediationAction = async (
		action: SetupRemediationAction,
		check: SetupCheckSnapshot,
	) => {
		if (isRootDirectoryPickerAction(action, check)) {
			setRootActionError(null);
			setRootApplyResult(null);

			const selection = await window.ensemble?.selectRootDirectory();

			if (!selection) {
				setRootActionError(
					'Root directory selection is unavailable in this context.',
				);
				return;
			}

			if (selection.canceled) {
				return;
			}

			if (selection.error || !selection.preview) {
				setRootActionError(
					selection.error ??
						'The selected root directory could not be previewed.',
				);
				return;
			}

			setRootSelection(selection);
			return;
		}

		if (isPiExecutablePickerAction(action, check)) {
			await window.ensemble?.selectPiExecutable();
			onRetry?.();
			return;
		}

		await onRemediationAction?.(action, check);
	};
	const confirmRootDirectoryChange = async () => {
		const path = rootSelection?.preview?.newRoot.path;

		if (!path) {
			setRootActionError('No root directory path was selected.');
			return;
		}

		setIsApplyingRootChange(true);
		setRootActionError(null);

		try {
			const result = await window.ensemble?.confirmRootDirectoryChange({
				path,
			});

			if (!result) {
				setRootActionError(
					'Root directory changes are unavailable in this context.',
				);
				return;
			}

			setRootApplyResult(result);
			onRetry?.();

			if (
				result.applied &&
				!result.error &&
				result.reconciliation?.status !== 'error'
			) {
				setRootSelection(null);
			}
		} finally {
			setIsApplyingRootChange(false);
		}
	};

	return (
		<ShellPanel
			action={
				<div className='flex items-center gap-2'>
					<StatusBadge tone={summary.tone}>{summary.badge}</StatusBadge>
					<Button
						disabled={isRetrying}
						onClick={onRetry}
						size='sm'
						type='button'
						variant='outline'
					>
						<RefreshCwIcon
							className={cn(isRetrying && 'animate-spin')}
							data-icon='inline-start'
						/>
						{isRetrying ? 'Retrying' : 'Retry checks'}
					</Button>
				</div>
			}
			description={summary.detail}
			eyebrow='Setup gate'
			title={summary.title}
		>
			<div className='flex flex-col gap-3'>
				{error ? (
					<div className='rounded-md border border-status-danger/30 bg-status-danger/10 px-3 py-2 text-status-danger text-xs leading-5'>
						{error}
					</div>
				) : null}
				{rootActionError ? (
					<div className='rounded-md border border-status-danger/30 bg-status-danger/10 px-3 py-2 text-status-danger text-xs leading-5'>
						{rootActionError}
					</div>
				) : null}

				<LocalExecutionNotice />

				{snapshot ? (
					<>
						<SetupDiagnosticsCompact snapshot={snapshot} />
						<div className='flex flex-col gap-3'>
							{GROUP_ORDER.map((group) => {
								const checks = snapshot.checks.filter(
									(check) => check.group === group,
								);

								if (!checks.length) {
									return null;
								}

								return (
									<section className='flex flex-col gap-2' key={group}>
										<div className='flex items-center justify-between gap-3'>
											<h2 className='font-medium text-xs'>
												{GROUP_LABELS[group]}
											</h2>
											<StatusBadge tone='muted'>
												{checks.length} checks
											</StatusBadge>
										</div>
										<div className='flex flex-col divide-y divide-border rounded-md border border-border bg-pane'>
											{checks.map((check) => (
												<SetupCheckRow
													check={check}
													key={check.id}
													onRemediationAction={handleRemediationAction}
													onRetry={onRetry}
												/>
											))}
										</div>
									</section>
								);
							})}
						</div>
					</>
				) : (
					<div className='flex items-center gap-2 rounded-md border border-border bg-pane px-3 py-3 text-muted-foreground text-xs'>
						<ClockIcon aria-hidden='true' className='size-4 shrink-0' />
						<span>Loading setup diagnostics</span>
					</div>
				)}
			</div>
			<RootDirectoryChangeDialog
				applyResult={rootApplyResult}
				isApplying={isApplyingRootChange}
				onConfirm={() => {
					void confirmRootDirectoryChange();
				}}
				onOpenChange={(open) => {
					if (!open) {
						setRootSelection(null);
						setRootApplyResult(null);
					}
				}}
				selection={rootSelection}
			/>
		</ShellPanel>
	);
}

/** Renders a one-line summary for the snapshot — counts plus blocking notice. */
function getSetupSummary(
	snapshot: SetupDiagnosticsSnapshot | null,
	error?: string | null,
): {
	badge: string;
	detail: string;
	title: string;
	tone: 'danger' | 'muted' | 'ok' | 'warning';
} {
	if (error) {
		return {
			badge: 'IPC error',
			detail: 'Setup diagnostics could not be loaded from the main process.',
			title: 'Setup diagnostics unavailable',
			tone: 'danger',
		};
	}

	if (!snapshot) {
		return {
			badge: 'Loading',
			detail: 'Ensemble is collecting setup diagnostics.',
			title: 'Checking setup readiness',
			tone: 'muted',
		};
	}

	if (snapshot.status === 'ready') {
		return {
			badge: 'Ready',
			detail: `${snapshot.successCount} checks passed and ${snapshot.warningCount} warnings remain.`,
			title: 'Core workflows are ready',
			tone: 'ok',
		};
	}

	if (snapshot.status === 'checking') {
		return {
			badge: 'Pending',
			detail: `${snapshot.blockedCount} required checks are still pending.`,
			title: 'Setup checks are still pending',
			tone: 'warning',
		};
	}

	return {
		badge: 'Blocked',
		detail: `${snapshot.blockedCount} required checks need attention before core workflows open.`,
		title: 'Core workflows are blocked',
		tone: 'danger',
	};
}
