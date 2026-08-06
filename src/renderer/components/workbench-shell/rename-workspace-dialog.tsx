import { useCallback, useMemo, useRef, useState } from 'react';
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
import { validateEntityName } from '@/renderer/lib/entity-name-validation';
import type { KeymapBinding } from '@/renderer/types/keymap';
import type { WorkspaceShellModel } from '@/renderer/types/workbench';
import type { RenameWorkspaceDiagnostic } from '@/shared/ipc/contracts/workspace';
import { toSlug } from '@/shared/slug';

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
		<Dialog onOpenChange={onOpenChange} open={open}>
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

const NAME_PATTERN = /^[A-Za-z0-9 ._-]+$/;

/** Inner state-owned form that resets each time the dialog re-opens. */
function RenameWorkspaceDialogForm({
	onOpenChange,
	workspace,
}: {
	onOpenChange: (open: boolean) => void;
	workspace: WorkspaceShellModel;
}) {
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
	const localValidation = validateEntityName({
		allowedCharacters: 'letters, numbers, spaces, dots, dashes, or underscores',
		name: trimmedName,
		noun: 'Workspace',
		pattern: NAME_PATTERN,
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
		localValidation === null &&
		!isUnchanged &&
		isEnsemblrApiAvailable();

	const handleRename = useCallback(async () => {
		if (!canRename) {
			return;
		}
		setStage('renaming');
		setDiagnostics([]);

		const result = await renameWorkspace({
			workspaceId: workspace.id,
			...(trimmedName !== workspace.name ? { name: trimmedName } : {}),
			...(!branchPinned && trimmedBranch !== workspace.branchName
				? { branchName: trimmedBranch }
				: {}),
		});

		if (result.status === 'success' && result.workspace) {
			await queryClient.invalidateQueries({
				queryKey: ensemblrQueryKeys.repositoryWorkspaceNavigation(),
			});
			toast.success(
				`Renamed to ${result.workspace.name} on branch ${result.workspace.branchName}.`,
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
					Rename workspace
				</DialogTitle>
				<p className='text-muted-foreground text-xs'>
					{branchPinned
						? 'Updates the workspace name. This workspace took over an existing branch, so the branch keeps its name. The worktree folder stays put.'
						: 'Updates the workspace name. The branch is auto-renamed from the slugged name unless you override it below. The worktree folder stays put.'}
				</p>
			</DialogHeader>

			<div className='flex flex-col gap-1.5'>
				<Label className='text-xs' htmlFor='rename-workspace-name'>
					Workspace name
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
							setBranchName(toSlug(next, 'workspace'));
						}
					}}
					onKeyDown={handleSubmitKey}
					value={name}
				/>
				{localValidation ? (
					<p className='text-[0.6875rem] text-destructive'>{localValidation}</p>
				) : null}
			</div>

			<div className='flex flex-col gap-1.5'>
				<Label className='text-xs' htmlFor='rename-workspace-branch'>
					Branch name
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
						? 'This branch came from a branch or pull request the workspace took over, so renaming it here would orphan that work.'
						: 'Follows the workspace name slug until you edit it.'}
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
				submitLabel={stage === 'renaming' ? 'Renaming…' : 'Rename'}
			/>
		</>
	);
}
