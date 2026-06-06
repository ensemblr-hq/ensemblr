import {
	AlertCircleIcon,
	CheckCircle2Icon,
	CircleDashedIcon,
	ClockIcon,
	RefreshCwIcon,
	ShieldAlertIcon,
} from 'lucide-react';
import { type ReactNode, useState } from 'react';

import { ShellPanel } from '@/components/shell-panel';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import type {
	RootDirectoryChangeApplyResult,
	RootDirectoryChangePreview,
	RootDirectorySelectionResult,
	SetupCheckGroupId,
	SetupCheckSnapshot,
	SetupCheckStatus,
	SetupDiagnosticsSnapshot,
	SetupRemediationAction,
} from '@/shared/ipc';

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

const CHECK_STATUS_LABELS: Record<SetupCheckStatus, string> = {
	failure: 'Failed',
	pending: 'Pending',
	running: 'Running',
	success: 'Ready',
	warning: 'Warning',
};

const CHECK_STATUS_TONE: Record<
	SetupCheckStatus,
	'danger' | 'info' | 'muted' | 'ok' | 'warning'
> = {
	failure: 'danger',
	pending: 'muted',
	running: 'info',
	success: 'ok',
	warning: 'warning',
};

const CHECK_STATUS_ICON = {
	failure: AlertCircleIcon,
	pending: CircleDashedIcon,
	running: RefreshCwIcon,
	success: CheckCircle2Icon,
	warning: ShieldAlertIcon,
} satisfies Record<SetupCheckStatus, typeof AlertCircleIcon>;

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

function LocalExecutionNotice() {
	return (
		<section
			className='rounded-md border border-status-warning/30 bg-status-warning/10 px-3 py-2.5'
			data-local-execution-notice='true'
		>
			<div className='flex items-start gap-2'>
				<ShieldAlertIcon
					aria-hidden='true'
					className='mt-0.5 size-4 shrink-0 text-status-warning'
				/>
				<div className='min-w-0'>
					<h2 className='font-medium text-xs'>Local execution</h2>
					<p className='mt-1 text-muted-foreground text-xs leading-5'>
						Agents, scripts, terminals, and tools run locally with your macOS
						account permissions. Workspace trusted mode is the default; stricter
						modes can require approval or read-only access where supported.
					</p>
				</div>
			</div>
		</section>
	);
}

export function SetupDiagnosticsCompact({
	snapshot,
}: {
	snapshot: SetupDiagnosticsSnapshot;
}) {
	const readyLabel =
		snapshot.status === 'ready'
			? 'Core workflows ready'
			: snapshot.status === 'checking'
				? 'Setup checks pending'
				: 'Core workflows blocked';

	return (
		<div className='grid grid-cols-2 gap-2 md:grid-cols-4'>
			<CompactMetric label='State' tone={getSnapshotTone(snapshot)}>
				{readyLabel}
			</CompactMetric>
			<CompactMetric label='Required' tone='muted'>
				{snapshot.requiredCount} checks
			</CompactMetric>
			<CompactMetric label='Blocked' tone='danger'>
				{snapshot.blockedCount}
			</CompactMetric>
			<CompactMetric label='Warnings' tone='warning'>
				{snapshot.warningCount}
			</CompactMetric>
		</div>
	);
}

function SetupCheckRow({
	check,
	onRemediationAction,
	onRetry,
}: {
	check: SetupCheckSnapshot;
	onRemediationAction?: (
		action: SetupRemediationAction,
		check: SetupCheckSnapshot,
	) => void | Promise<void>;
	onRetry?: () => void;
}) {
	const Icon = CHECK_STATUS_ICON[check.status];
	const handleRemediationAction = async (action: SetupRemediationAction) => {
		if (onRemediationAction) {
			await onRemediationAction(action, check);
			return;
		}

		if (
			action.kind === 'select-path' &&
			action.target === 'pi.executablePath' &&
			check.id === 'pi-executable'
		) {
			await window.ensemble?.selectPiExecutable();
			onRetry?.();
		}
	};

	return (
		<div className='flex flex-col gap-2 px-3 py-2.5'>
			<div className='flex items-start justify-between gap-3'>
				<div className='flex min-w-0 items-start gap-2'>
					<Icon
						aria-hidden='true'
						className={cn(
							'mt-0.5 size-4 shrink-0',
							check.status === 'failure' && 'text-status-danger',
							check.status === 'success' && 'text-status-ok',
							check.status === 'warning' && 'text-status-warning',
							check.status === 'pending' && 'text-muted-foreground',
							check.status === 'running' && 'text-accent',
						)}
					/>
					<div className='min-w-0'>
						<div className='flex flex-wrap items-center gap-1.5'>
							<h3 className='font-medium text-xs'>{check.title}</h3>
							{check.blocking ? (
								<StatusBadge tone='muted'>Required</StatusBadge>
							) : (
								<StatusBadge tone='info'>Optional</StatusBadge>
							)}
						</div>
						<p className='mt-1 text-muted-foreground text-xs leading-5'>
							{check.detail}
						</p>
						<p className='mt-1 text-[0.6875rem] text-muted-foreground leading-4'>
							{check.description}
						</p>
					</div>
				</div>
				<StatusBadge tone={CHECK_STATUS_TONE[check.status]}>
					{CHECK_STATUS_LABELS[check.status]}
				</StatusBadge>
			</div>

			{check.remediationActions.length ? (
				<div className='flex flex-wrap gap-1.5 pl-6'>
					{check.remediationActions.map((action) =>
						isRemediationActionButton(action, check) ? (
							<Button
								className='h-6 px-2 text-[0.6875rem] leading-none'
								data-remediation-action={action.id}
								key={action.id}
								onClick={() => {
									void handleRemediationAction(action);
								}}
								size='xs'
								type='button'
								variant='outline'
							>
								{action.label}
							</Button>
						) : (
							<span
								className='rounded-sm border border-border bg-muted px-1.5 py-1 text-[0.6875rem] text-muted-foreground leading-none'
								key={action.id}
							>
								{action.label}
							</span>
						),
					)}
				</div>
			) : null}

			{check.logs.length ? (
				<details className='ml-6 rounded-md border border-border bg-background/60 px-2 py-1.5 text-xs'>
					<summary className='cursor-default text-muted-foreground'>
						Diagnostics log
					</summary>
					<div className='mt-1.5 flex flex-col gap-1'>
						{check.logs.slice(0, 4).map((log) => (
							<p
								className='break-words text-muted-foreground leading-5'
								key={`${log.label}-${log.text}`}
							>
								<span className='font-medium text-foreground'>{log.label}</span>
								{': '}
								{log.text}
								{log.truncated ? ' (truncated)' : null}
							</p>
						))}
					</div>
				</details>
			) : null}
		</div>
	);
}

function isPiExecutablePickerAction(
	action: SetupRemediationAction,
	check: SetupCheckSnapshot,
): boolean {
	return (
		check.id === 'pi-executable' &&
		action.kind === 'select-path' &&
		action.target === 'pi.executablePath'
	);
}

function isRootDirectoryPickerAction(
	action: SetupRemediationAction,
	check: SetupCheckSnapshot,
): boolean {
	return (
		check.id === 'root-directory' &&
		action.kind === 'select-path' &&
		(action.target === 'rootDirectory' || action.id === 'choose-root-directory')
	);
}

function isRemediationActionButton(
	action: SetupRemediationAction,
	check: SetupCheckSnapshot,
): boolean {
	return (
		isPiExecutablePickerAction(action, check) ||
		isRootDirectoryPickerAction(action, check)
	);
}

export function RootDirectoryChangeDialog({
	applyResult,
	isApplying,
	onConfirm,
	onOpenChange,
	selection,
}: {
	applyResult: RootDirectoryChangeApplyResult | null;
	isApplying: boolean;
	onConfirm: () => void;
	onOpenChange: (open: boolean) => void;
	selection: RootDirectorySelectionResult | null;
}) {
	const preview = selection?.preview ?? null;
	const canApply = Boolean(preview?.canApply) && !isApplying;

	return (
		<Dialog onOpenChange={onOpenChange} open={Boolean(selection)}>
			<DialogContent className='sm:max-w-lg'>
				<RootDirectoryChangeContent
					applyResult={applyResult}
					canApply={canApply}
					isApplying={isApplying}
					onConfirm={onConfirm}
					preview={preview}
					useDialogHeader
				/>
			</DialogContent>
		</Dialog>
	);
}

export function RootDirectoryChangeContent({
	applyResult,
	canApply,
	isApplying,
	onConfirm,
	preview,
	useDialogHeader = false,
}: {
	applyResult: RootDirectoryChangeApplyResult | null;
	canApply: boolean;
	isApplying: boolean;
	onConfirm: () => void;
	preview: RootDirectoryChangePreview | null;
	useDialogHeader?: boolean;
}) {
	return (
		<>
			{useDialogHeader ? (
				<DialogHeader>
					<DialogTitle>Change root directory</DialogTitle>
					<DialogDescription>
						Switch Ensemble to the selected root and reindex/adopt from that
						filesystem layout after confirmation.
					</DialogDescription>
				</DialogHeader>
			) : (
				<div className='flex flex-col gap-2'>
					<h2 className='font-heading font-medium text-base leading-none'>
						Change root directory
					</h2>
					<p className='text-muted-foreground text-sm'>
						Switch Ensemble to the selected root and reindex/adopt from that
						filesystem layout after confirmation.
					</p>
				</div>
			)}

			{preview ? (
				<div className='flex flex-col gap-3'>
					<RootPathPreview preview={preview} />
					<section className='rounded-md border border-status-warning/30 bg-status-warning/10 px-3 py-2.5 text-xs leading-5'>
						<p className='font-medium text-foreground'>
							Old root contents are preserved.
						</p>
						<p className='mt-1 text-muted-foreground'>
							Switching changes where Ensemble looks for repos, workspaces, and
							archived contexts. Reindex/adopt is the default behavior.
							Migration is a separate action. Delete or cleanup is a separate
							destructive action.
						</p>
						<p className='mt-1 text-muted-foreground'>
							Shared Conductor root continuity covers filesystem, git, and
							config only; chat/session/checkpoint continuity is not guaranteed
							across apps.
						</p>
					</section>
					<RootDirectoryDiagnostics
						diagnostics={preview.diagnostics}
						emptyLabel='No blocking root warnings.'
					/>
					{applyResult ? (
						<RootDirectoryApplyResult result={applyResult} />
					) : null}
				</div>
			) : null}

			<DialogFooter>
				<Button
					disabled={!canApply}
					onClick={onConfirm}
					type='button'
					variant='default'
				>
					{isApplying ? 'Applying' : 'Switch root'}
				</Button>
			</DialogFooter>
		</>
	);
}

function RootPathPreview({ preview }: { preview: RootDirectoryChangePreview }) {
	return (
		<div className='grid gap-2 text-xs'>
			<div className='rounded-md border border-border bg-background/60 px-3 py-2'>
				<p className='font-medium'>Current root</p>
				<code className='mt-1 block break-all text-muted-foreground'>
					{preview.oldRoot?.path ?? 'No current root snapshot'}
				</code>
			</div>
			<div className='rounded-md border border-border bg-background/60 px-3 py-2'>
				<p className='font-medium'>Selected root</p>
				<code className='mt-1 block break-all text-muted-foreground'>
					{preview.newRoot.path}
				</code>
			</div>
		</div>
	);
}

function RootDirectoryDiagnostics({
	diagnostics,
	emptyLabel,
}: {
	diagnostics: RootDirectoryChangePreview['diagnostics'];
	emptyLabel: string;
}) {
	if (!diagnostics.length) {
		return (
			<p className='text-muted-foreground text-xs leading-5'>{emptyLabel}</p>
		);
	}

	return (
		<div className='flex flex-col gap-1.5'>
			{diagnostics.map((diagnostic) => (
				<div
					className='rounded-md border border-border bg-muted px-2 py-1.5 text-xs leading-5'
					key={`${diagnostic.code}-${diagnostic.path ?? diagnostic.message}`}
				>
					<div className='flex flex-wrap items-center gap-1.5'>
						<StatusBadge
							tone={
								diagnostic.severity === 'error'
									? 'danger'
									: diagnostic.severity === 'warning'
										? 'warning'
										: 'info'
							}
						>
							{diagnostic.severity}
						</StatusBadge>
						<span className='font-medium'>{diagnostic.code}</span>
					</div>
					<p className='mt-1 text-muted-foreground'>{diagnostic.message}</p>
					{diagnostic.path ? (
						<code className='mt-1 block break-all text-muted-foreground'>
							{diagnostic.path}
						</code>
					) : null}
				</div>
			))}
		</div>
	);
}

function RootDirectoryApplyResult({
	result,
}: {
	result: RootDirectoryChangeApplyResult;
}) {
	return (
		<section className='rounded-md border border-border bg-background/60 px-3 py-2 text-xs leading-5'>
			<div className='flex items-center gap-2'>
				<StatusBadge tone={getRootDirectoryApplyResultTone(result)}>
					{result.applied ? 'Applied' : 'Not applied'}
				</StatusBadge>
				<span className='font-medium'>Root switch result</span>
			</div>
			{result.error ? (
				<p className='mt-1 text-status-danger'>{result.error}</p>
			) : null}
			{result.reconciliation ? (
				<p className='mt-1 text-muted-foreground'>
					Reconciliation scanned{' '}
					{result.reconciliation.repositoryDirectoryCount} repository
					directories and {result.reconciliation.workspaceDirectoryCount}{' '}
					workspace directories.
				</p>
			) : null}
			{result.reconciliation?.diagnostics.length ? (
				<div className='mt-2'>
					<RootDirectoryDiagnostics
						diagnostics={result.reconciliation.diagnostics}
						emptyLabel='No reconciliation warnings.'
					/>
				</div>
			) : null}
		</section>
	);
}

function getRootDirectoryApplyResultTone(
	result: RootDirectoryChangeApplyResult,
) {
	if (
		result.error ||
		!result.applied ||
		result.reconciliation?.status === 'error'
	) {
		return 'danger';
	}

	if (result.reconciliation?.status === 'warning') {
		return 'warning';
	}

	return 'ok';
}

function CompactMetric({
	children,
	label,
	tone,
}: {
	children: ReactNode;
	label: string;
	tone: 'danger' | 'info' | 'muted' | 'ok' | 'warning';
}) {
	return (
		<div className='flex min-h-16 flex-col justify-between rounded-md border border-border bg-pane px-2.5 py-2'>
			<div className='flex items-center justify-between gap-2'>
				<span className='text-[0.6875rem] text-muted-foreground uppercase tracking-wide'>
					{label}
				</span>
				<StatusBadge tone={tone}>{label}</StatusBadge>
			</div>
			<div className='mt-2 font-medium text-xs'>{children}</div>
		</div>
	);
}

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

function getSnapshotTone(
	snapshot: SetupDiagnosticsSnapshot,
): 'danger' | 'ok' | 'warning' {
	if (snapshot.status === 'ready') {
		return 'ok';
	}

	if (snapshot.status === 'checking') {
		return 'warning';
	}

	return 'danger';
}
