import { useQuery } from '@tanstack/react-query';
import { useCallback } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import {
	archiveWorkspace,
	isEnsemblrApiAvailable,
	reviewMergeSettingsQuery,
	workspaceGitStatusQuery,
} from '@/renderer/api/ensemblr-queries';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from '@/renderer/components/ui/dialog';
import { LifecycleDialogActions } from '@/renderer/components/workbench-shell/lifecycle-dialog-actions';
import { LifecycleSummary } from '@/renderer/components/workbench-shell/lifecycle-summary';
import { useArchiveWorkspaceHop } from '@/renderer/hooks/workbench-shell/use-archive-workspace-hop';
import { useLifecycleDialogAction } from '@/renderer/hooks/workbench-shell/use-lifecycle-dialog-action';
import {
	type ArchivedWorkspace,
	resolveArchiveWorktreePlan,
} from '@/renderer/lib/workbench/archive-worktree-plan';
import { workspaceSummaryRows } from '@/renderer/lib/workbench/lifecycle-summary-rows';
import { useArchivingWorkspaceActions } from '@/renderer/state/workspace';
import type { WorkspaceShellModel } from '@/renderer/types/workbench';
import type { ArchiveWorkspaceDiagnostic } from '@/shared/ipc/contracts/workspace';

/**
 * Lifecycle archive dialog: preserves the workspace `.context/` folder and
 * archives the workspace as a state. What happens to the worktree and local
 * branch is the repository's resolved `deleteLocalBranchOnArchive` and
 * `reclaimDiskOnArchive` settings, the same ones the merge-then-archive flow
 * obeys. A setting that cannot be resolved keeps both and says so rather than
 * guessing.
 *
 * An archive is reversible, so it is not confirmed as a rule: this dialog is
 * the escalation `useArchiveWorkspaceAction` raises for the archives that are
 * not — a worktree carrying uncommitted changes, a plan that drops the local
 * branch along with any unpushed commit on it, or a git read that could not say
 * which of those applies.
 *
 * A confirmed archive is still the same run, so it carries the same live state
 * as the unconfirmed one: the workspace is marked archiving for the whole of it,
 * and the shell leaves the workspace before the teardown starts. Escalating is
 * what makes that matter most — these are the slowest archives, against the
 * worktrees with the most in them.
 */
export function ArchiveWorkspaceDialog({
	activeWorkspaceId,
	onArchived,
	onOpenChange,
	open,
	workspace,
}: {
	activeWorkspaceId: string | null;
	onArchived: (archived: ArchivedWorkspace) => Promise<void> | void;
	onOpenChange: (open: boolean) => void;
	open: boolean;
	workspace: WorkspaceShellModel | null;
}) {
	// Never open without a workspace: callers that hold `open` and `workspace` in
	// separate state drop the workspace the moment it is archived, and an open
	// dialog with nothing to render is an empty shell whose overlay still eats
	// every click, leaving the app unusable with no way to dismiss it.
	return (
		<Dialog onOpenChange={onOpenChange} open={open && workspace !== null}>
			<DialogContent className='sm:max-w-md'>
				{workspace ? (
					<ArchiveWorkspaceDialogForm
						activeWorkspaceId={activeWorkspaceId}
						key={`${workspace.id}:${open ? 'open' : 'closed'}`}
						onArchived={onArchived}
						onOpenChange={onOpenChange}
						workspace={workspace}
					/>
				) : null}
			</DialogContent>
		</Dialog>
	);
}

/**
 * Wraps an unexpected archive-workspace rejection as the diagnostic the dialog
 * already renders — a denied permission gate throws rather than reporting.
 * @param message - The thrown error's message
 * @returns A diagnostic carrying it
 */
function archiveWorkspaceFailure(message: string): ArchiveWorkspaceDiagnostic {
	return { code: 'workspace-update-failed', message, severity: 'error' };
}

/** The two `<0>`/`<1>` slots every archive description interpolates a path into. */
const CONTEXT_PATH_COMPONENTS = [
	<span className='font-mono' key='context-dir' />,
	<span className='font-mono' key='archived-contexts-dir' />,
];

/**
 * Says what this archive will actually do to the worktree, which is the one
 * thing the user cannot tell by looking. The three states are genuinely
 * different outcomes — the branch is dropped, the folder is reclaimed and the
 * branch kept, or nothing on disk is touched — so each gets its own sentence
 * rather than a hedged one covering all three.
 */
function ArchiveDescription({
	branchCleanup,
	reclaimDisk,
}: {
	branchCleanup: boolean;
	reclaimDisk: boolean;
}) {
	if (branchCleanup) {
		return (
			<Trans
				components={CONTEXT_PATH_COMPONENTS}
				defaults='Marks the workspace as archived and preserves its <0>.context/</0> handoff files under <1>archived-contexts/</1>. The worktree folder is removed and the local branch dropped, per your git settings; anything else not pushed to the remote will be lost.'
				i18nKey='workbench:archive-workspace.description-cleanup'
			/>
		);
	}

	if (reclaimDisk) {
		return (
			<Trans
				components={CONTEXT_PATH_COMPONENTS}
				defaults='Marks the workspace as archived and preserves its <0>.context/</0> handoff files under <1>archived-contexts/</1>. The worktree folder is removed to reclaim its disk, keeping the branch and a snapshot of any uncommitted changes; unarchiving restores both and rebuilds dependencies.'
				i18nKey='workbench:archive-workspace.description-reclaim'
			/>
		);
	}

	return (
		<Trans
			components={CONTEXT_PATH_COMPONENTS}
			defaults='Marks the workspace as archived and preserves its <0>.context/</0> handoff files under <1>archived-contexts/</1>. The worktree folder and local branch stay on disk; nothing is committed or pushed.'
			i18nKey='workbench:archive-workspace.description-keep'
		/>
	);
}

/**
 * Names the uncommitted work an archive is about to leave behind. Renders
 * nothing when the worktree is clean — a branch-dropping plan and an unreadable
 * git status both reach this dialog with no count to report, and the
 * description below already words those.
 */
function UncommittedChangesNotice({ workspaceCwd }: { workspaceCwd: string }) {
	const { t } = useTranslation();
	// Already fetched by the action that escalated here, so this reads the cache
	// rather than the worktree.
	const { data: gitStatus } = useQuery(workspaceGitStatusQuery(workspaceCwd));
	const fileCount = gitStatus?.error ? 0 : (gitStatus?.summary.files ?? 0);

	if (fileCount === 0) {
		return null;
	}

	return (
		<span
			className='mb-2 block text-foreground'
			data-testid='archive-workspace-uncommitted'
		>
			{t('workbench:archive-workspace.uncommitted', {
				count: fileCount,
				defaultValue_one:
					'This workspace has {{count}} uncommitted change that archiving will not commit or push.',
				defaultValue_other:
					'This workspace has {{count}} uncommitted changes that archiving will not commit or push.',
			})}
		</span>
	);
}

/** Inner archive form for a workspace; owns the archiving state and reads the worktree-cleanup policy. */
function ArchiveWorkspaceDialogForm({
	activeWorkspaceId,
	onArchived,
	onOpenChange,
	workspace,
}: {
	activeWorkspaceId: string | null;
	onArchived: (archived: ArchivedWorkspace) => Promise<void> | void;
	onOpenChange: (open: boolean) => void;
	workspace: WorkspaceShellModel;
}) {
	const { t } = useTranslation();
	const archiveAwayFromWorkspace = useArchiveWorkspaceHop({
		activeWorkspaceId,
	});
	const { clearArchiving, markArchiving } = useArchivingWorkspaceActions();
	// The worktree being archived is the checkout whose committed
	// `.ensemblr/settings.toml` applies to this branch, so resolve against it
	// rather than the repository root.
	const {
		data: gitSettings,
		isError: hasSettingsError,
		isPending: isResolvingSettings,
	} = useQuery(
		reviewMergeSettingsQuery({
			repositoryId: workspace.projectId,
			repositoryPath: workspace.pathLabel,
		}),
	);
	const plan = resolveArchiveWorktreePlan({
		hasBranch: Boolean(workspace.branchName),
		settings: gitSettings,
	});
	const { diagnostics, isBusy, start } = useLifecycleDialogAction({
		failure: archiveWorkspaceFailure,
		onOpenChange,
		onSucceeded: () =>
			onArchived({
				branchCleanup: plan.branchCleanup,
				workspaceId: workspace.id,
			}),
		operationKey: `archive-workspace:${workspace.id}`,
		run: () =>
			archiveAwayFromWorkspace(workspace.id, () =>
				archiveWorkspace({ ...plan, workspaceId: workspace.id }),
			),
	});

	// `start` resolves only once the post-removal work has run, so marking around
	// it is what keeps the row saying "Archiving…" until it has left the list —
	// the same span the unconfirmed path marks.
	const startArchive = useCallback(async () => {
		markArchiving(workspace.id);
		try {
			await start();
		} finally {
			clearArchiving(workspace.id);
		}
	}, [clearArchiving, markArchiving, start, workspace.id]);

	// Archiving before the resolver answers would silently skip the cleanup the
	// setting asked for, because an unanswered query reads as `false`. A resolver
	// that failed outright reads as `false` too, so the archive stays available
	// but says on screen what it is about to do instead.
	const canArchive =
		!isBusy && !isResolvingSettings && isEnsemblrApiAvailable();

	const handleClose = useCallback(() => {
		onOpenChange(false);
	}, [onOpenChange]);

	return (
		<>
			<DialogHeader>
				<DialogTitle>
					{t('workbench:archive-workspace.title', 'Archive workspace?')}
				</DialogTitle>
				<DialogDescription className='text-xs'>
					<UncommittedChangesNotice workspaceCwd={workspace.pathLabel} />
					<ArchiveDescription
						branchCleanup={plan.branchCleanup}
						reclaimDisk={plan.reclaimDisk}
					/>
				</DialogDescription>
			</DialogHeader>

			<LifecycleSummary rows={workspaceSummaryRows(workspace)} />

			{hasSettingsError ? (
				<p
					className='text-status-danger text-xs'
					data-testid='archive-workspace-settings-error'
				>
					{t(
						'workbench:archive-workspace.settings-unavailable',
						'Your git settings could not be read, so the worktree folder and local branch will be kept.',
					)}
				</p>
			) : null}

			<LifecycleDialogActions
				actionLabel={t('common:actions.archive', 'Archive')}
				actionVariant={plan.branchCleanup ? 'destructive' : 'default'}
				canAct={canArchive}
				diagnostics={diagnostics}
				diagnosticsTestId='archive-workspace-diagnostics'
				isBusy={isBusy}
				onAct={startArchive}
				onClose={handleClose}
			/>
		</>
	);
}
