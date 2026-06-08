import type { KeyboardEvent } from 'react';
import { useCallback, useRef, useState } from 'react';
import { toast } from 'sonner';

import {
	ensembleQueryKeys,
	isEnsembleApiAvailable,
	renameWorkspace,
} from '@/renderer/api/ensemble-queries';
import { queryClient } from '@/renderer/api/query-client';
import { Button } from '@/renderer/components/ui/button';
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from '@/renderer/components/ui/dialog';
import { Input } from '@/renderer/components/ui/input';
import { Label } from '@/renderer/components/ui/label';
import type { WorkspaceShellModel } from '@/renderer/types/workbench';
import type { RenameWorkspaceDiagnostic } from '@/shared/ipc';

interface RenameWorkspaceDialogProps {
	onOpenChange: (open: boolean) => void;
	open: boolean;
	workspace: WorkspaceShellModel | null;
}

/** Modal that renames the selected workspace, optionally renaming its branch. */
export function RenameWorkspaceDialog({
	onOpenChange,
	open,
	workspace,
}: RenameWorkspaceDialogProps) {
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

type RenameWorkspaceStage = 'failure' | 'idle' | 'renaming';

const NAME_PATTERN = /^[A-Za-z0-9 ._-]+$/;
const NAME_MAX_LENGTH = 100;

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
	const localValidation = validateNameLocally(trimmedName);
	const isUnchanged =
		trimmedName === workspace.name && trimmedBranch === workspace.branchName;
	const canRename =
		stage !== 'renaming' &&
		trimmedName.length > 0 &&
		localValidation === null &&
		!isUnchanged &&
		isEnsembleApiAvailable();

	const handleRename = useCallback(async () => {
		if (!canRename) {
			return;
		}
		setStage('renaming');
		setDiagnostics([]);

		const result = await renameWorkspace({
			workspaceId: workspace.id,
			...(trimmedName !== workspace.name ? { name: trimmedName } : {}),
			...(trimmedBranch !== workspace.branchName
				? { branchName: trimmedBranch }
				: {}),
		});

		if (result.status === 'success' && result.workspace) {
			await queryClient.invalidateQueries({
				queryKey: ensembleQueryKeys.repositoryWorkspaceNavigation(),
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
		canRename,
		onOpenChange,
		trimmedBranch,
		trimmedName,
		workspace.branchName,
		workspace.id,
		workspace.name,
	]);

	const handleSubmitKey = useCallback(
		(event: KeyboardEvent<HTMLInputElement>) => {
			if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
				event.preventDefault();
				handleRename();
			}
		},
		[handleRename],
	);

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
					Updates the workspace name. The branch is auto-renamed from the
					slugged name unless you override it below. The worktree folder stays
					put.
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
						if (!branchTouchedRef.current) {
							setBranchName(toBranchSlug(next));
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
					disabled={isBusy}
					id='rename-workspace-branch'
					onChange={(event) => {
						branchTouchedRef.current = true;
						setBranchName(event.target.value);
					}}
					onKeyDown={handleSubmitKey}
					value={branchName}
				/>
				<p className='text-[0.6875rem] text-muted-foreground'>
					Follows the workspace name slug until you edit it.
				</p>
			</div>

			{stage === 'failure' && diagnostics.length > 0 ? (
				<RenameWorkspaceDiagnosticsList diagnostics={diagnostics} />
			) : null}

			<div className='-mx-4 -mb-4 flex justify-end gap-2 rounded-b-xl border-border border-t bg-muted/40 px-4 py-3'>
				{stage === 'failure' ? (
					<Button
						className='h-8'
						onClick={handleRetry}
						type='button'
						variant='outline'
					>
						Try again
					</Button>
				) : null}
				<Button
					className='h-8 gap-2'
					disabled={!canRename}
					onClick={handleRename}
					type='button'
				>
					{stage === 'renaming' ? 'Renaming…' : 'Rename'}
					<span
						aria-hidden='true'
						className='ml-1 inline-flex items-center gap-0.5 text-[0.6875rem] opacity-70'
					>
						⌘↵
					</span>
				</Button>
			</div>
		</>
	);
}

/** Renders the diagnostics card shown on a rename failure. */
function RenameWorkspaceDiagnosticsList({
	diagnostics,
}: {
	diagnostics: RenameWorkspaceDiagnostic[];
}) {
	return (
		<ul
			className='rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-destructive text-xs'
			data-testid='rename-workspace-diagnostics'
		>
			{diagnostics.map((diagnostic) => (
				<li className='flex flex-col gap-0.5' key={diagnostic.code}>
					<span className='font-medium'>{diagnostic.message}</span>
					{diagnostic.path ? (
						<span className='font-mono text-[0.6875rem] opacity-80'>
							{diagnostic.path}
						</span>
					) : null}
				</li>
			))}
		</ul>
	);
}

/** Mirrors the backend `toSlug` so the branch preview matches what ships. */
function toBranchSlug(value: string): string {
	const slug = value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
	return slug || 'workspace';
}

/**
 * Mirrors the main-process workspace name rules so we surface immediate
 * feedback before the IPC round-trip.
 */
function validateNameLocally(name: string): string | null {
	if (!name) {
		return null;
	}
	if (name.length > NAME_MAX_LENGTH) {
		return `Workspace names must be ${NAME_MAX_LENGTH} characters or fewer.`;
	}
	if (name === '.' || name === '..' || name.startsWith('.')) {
		return 'Workspace names cannot start with a dot.';
	}
	if (!NAME_PATTERN.test(name)) {
		return 'Use only letters, numbers, spaces, dots, dashes, or underscores.';
	}
	return null;
}
