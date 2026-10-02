import { useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import {
	ensemblrQueryKeys,
	isEnsemblrApiAvailable,
	renameWorkspace,
} from '@/renderer/api/ensemblr-queries';
import { queryClient } from '@/renderer/api/query-client';
import { DialogActionFooter } from '@/renderer/components/dialog-action-footer';
import { DialogDiagnosticsList } from '@/renderer/components/dialog-diagnostics-list';
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from '@/renderer/components/ui/dialog';
import { Input } from '@/renderer/components/ui/input';
import { Label } from '@/renderer/components/ui/label';
import { useKeymapHandler } from '@/renderer/hooks/use-keymap-handler';
import {
	entityNameIssueText,
	validateEntityName,
} from '@/renderer/lib/entity-name-validation';
import type { KeymapBinding } from '@/renderer/types/keymap';
import type { WorkspaceShellModel } from '@/renderer/types/workbench';
import { composeRenamedBranch } from '@/shared/branch-name';
import type { RenameWorkspaceDiagnostic } from '@/shared/ipc/contracts/workspace';
import { toSlug } from '@/shared/slug';
import { WORKSPACE_NAME_PATTERN } from '@/shared/workspace-name';

/** Modal that renames the selected workspace, optionally renaming its branch. */
export function RenameWorkspaceDialog({
	onOpenChange,
	open,
	workspace,
}: {
	onOpenChange: (open: boolean) => void;
	open: boolean;
	workspace: WorkspaceShellModel | null;
}) {
	return (
		// Never open without a workspace: callers that hold `open` and `workspace`
		// in separate state drop the workspace the moment it goes away, and an open
		// dialog with nothing to render is an empty shell whose overlay still eats
		// every click, leaving the app unusable with no way to dismiss it.
		<Dialog onOpenChange={onOpenChange} open={open && workspace !== null}>
			<DialogContent className='gap-4 sm:max-w-lg'>
				{workspace ? (
					<RenameWorkspaceDialogForm
						key={`${workspace.id}:${open ? 'open' : 'closed'}`}
						onOpenChange={onOpenChange}
						workspace={workspace}
					/>
				) : null}
			</DialogContent>
		</Dialog>
	);
}

/** Progress stage of the workspace rename flow. */
type RenameWorkspaceStage = 'failure' | 'idle' | 'renaming';

/** Inner state-owned form that resets each time the dialog re-opens. */
function RenameWorkspaceDialogForm({
	onOpenChange,
	workspace,
}: {
	onOpenChange: (open: boolean) => void;
	workspace: WorkspaceShellModel;
}) {
	const { t } = useTranslation();
	const [name, setName] = useState(workspace.name);
	const [branchName, setBranchName] = useState(workspace.branchName);
	// Handler-only flag (never read during render): a ref avoids needless state.
	const branchTouchedRef = useRef(false);
	const [stage, setStage] = useState<RenameWorkspaceStage>('idle');
	const [diagnostics, setDiagnostics] = useState<RenameWorkspaceDiagnostic[]>(
		[],
	);

	const trimmedName = name.trim();
	const trimmedBranch = branchName.trim();
	const nameIssue = validateEntityName({
		name: trimmedName,
		pattern: WORKSPACE_NAME_PATTERN,
	});
	// An adopted branch may already back a pull request, so the service refuses to
	// move it; pin the field rather than let the user submit a rejected rename.
	const branchPinned = workspace.adoptedBranch === true;
	const isUnchanged =
		trimmedName === workspace.name &&
		(branchPinned || trimmedBranch === workspace.branchName);
	const canRename =
		stage !== 'renaming' &&
		trimmedName.length > 0 &&
		nameIssue === null &&
		!isUnchanged &&
		isEnsemblrApiAvailable();

	const handleRename = useCallback(async () => {
		if (!canRename) {
			return;
		}
		setStage('renaming');
		setDiagnostics([]);

		// Sent whenever the user has touched the field, even unchanged: omitting it
		// lets the service derive a branch from the new name, which would move the
		// branch out from under the value they are looking at.
		const sendsBranch =
			!branchPinned &&
			(branchTouchedRef.current || trimmedBranch !== workspace.branchName);
		const result = await renameWorkspace({
			workspaceId: workspace.id,
			...(trimmedName !== workspace.name ? { name: trimmedName } : {}),
			...(sendsBranch ? { branchName: trimmedBranch } : {}),
		});

		if (result.status === 'success' && result.workspace) {
			await queryClient.invalidateQueries({
				queryKey: ensemblrQueryKeys.repositoryWorkspaceNavigation(),
			});
			toast.success(
				t(
					'workbench:workspace-rename.succeeded',
					'Renamed to {{name}} on branch {{branch}}.',
					{
						branch: result.workspace.branchName,
						name: result.workspace.name,
					},
				),
			);
			onOpenChange(false);
			return;
		}

		setStage('failure');
		setDiagnostics(result.diagnostics);
	}, [
		branchPinned,
		canRename,
		onOpenChange,
		t,
		trimmedBranch,
		trimmedName,
		workspace.branchName,
		workspace.id,
		workspace.name,
	]);

	const submitBindings = useMemo<readonly KeymapBinding<HTMLInputElement>[]>(
		() => [
			[
				'dialog.submit',
				() => {
					handleRename();
				},
			],
		],
		[handleRename],
	);
	const handleSubmitKey = useKeymapHandler(submitBindings);

	const handleRetry = useCallback(() => {
		setStage('idle');
		setDiagnostics([]);
	}, []);

	const isBusy = stage === 'renaming';

	return (
		<>
			<DialogHeader>
				<DialogTitle className='font-medium text-[0.9375rem]'>
					{t('workbench:rename-workspace.title', 'Rename workspace')}
				</DialogTitle>
				<p className='text-muted-foreground text-xs'>
					{branchPinned
						? t(
								'workbench:rename-workspace.description-pinned',
								'Updates the workspace name. This workspace took over an existing branch, so the branch keeps its name. The worktree folder stays put.',
							)
						: t(
								'workbench:rename-workspace.description',
								'Updates the workspace name. The branch is auto-renamed from the slugged name unless you override it below. The worktree folder stays put.',
							)}
				</p>
			</DialogHeader>

			<div className='flex flex-col gap-1.5'>
				<Label className='text-xs' htmlFor='rename-workspace-name'>
					{t('workbench:rename-workspace.name.label', 'Workspace name')}
				</Label>
				<Input
					autoFocus
					className='h-9'
					disabled={isBusy}
					id='rename-workspace-name'
					onChange={(event) => {
						const next = event.target.value;
						setName(next);
						if (!branchPinned && !branchTouchedRef.current) {
							setBranchName(
								composeRenamedBranch(
									workspace.branchName,
									toSlug(next, 'workspace'),
								),
							);
						}
					}}
					onKeyDown={handleSubmitKey}
					value={name}
				/>
				{nameIssue ? (
					<p className='text-[0.6875rem] text-destructive'>
						{entityNameIssueText(t, 'workspace', nameIssue)}
					</p>
				) : null}
			</div>

			<div className='flex flex-col gap-1.5'>
				<Label className='text-xs' htmlFor='rename-workspace-branch'>
					{t('workbench:rename-workspace.branch.label', 'Branch name')}
				</Label>
				<Input
					className='h-9 font-mono text-xs'
					disabled={isBusy || branchPinned}
					id='rename-workspace-branch'
					onChange={(event) => {
						branchTouchedRef.current = true;
						setBranchName(event.target.value);
					}}
					onKeyDown={handleSubmitKey}
					value={branchName}
				/>
				<p className='text-[0.6875rem] text-muted-foreground'>
					{branchPinned
						? t(
								'workbench:rename-workspace.branch.pinned-hint',
								'This branch came from a branch or pull request the workspace took over, so renaming it here would orphan that work.',
							)
						: t(
								'workbench:rename-workspace.branch.hint',
								'Follows the workspace name slug until you edit it.',
							)}
				</p>
			</div>

			{stage === 'failure' && diagnostics.length > 0 ? (
				<DialogDiagnosticsList
					diagnostics={diagnostics}
					testId='rename-workspace-diagnostics'
				/>
			) : null}

			<DialogActionFooter
				onRetry={stage === 'failure' ? handleRetry : null}
				onSubmit={handleRename}
				submitDisabled={!canRename}
				submitLabel={t('common:actions.rename', 'Rename')}
				submitPending={stage === 'renaming'}
			/>
		</>
	);
}
