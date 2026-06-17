import { useQuery } from '@tanstack/react-query';
import {
	FileDiffIcon,
	MessageSquarePlusIcon,
	TriangleAlertIcon,
} from 'lucide-react';
import type { BundledLanguage } from 'shiki';
import { toast } from 'sonner';

import { workspaceFileDiffQuery } from '@/renderer/api/ensemble-queries';
import { CodeBlockContent } from '@/renderer/components/code-block';
import { Button } from '@/renderer/components/ui/button';
import { formatFileDiffContext } from '@/renderer/lib/workbench/review-context';
import { useComposerInsert } from '@/renderer/state/composer';
import type { WorkspaceGitDiffScope } from '@/shared/ipc/contracts/workspace-git';

import { FileCommentSection } from './file-comment-section';

/**
 * Read-only unified diff surface for a single file, shown when a `kind: 'diff'`
 * tab carries a `filePath` instead of a checkpoint turn. The optional `scope`
 * selects which diff to show (working tree by default, a commit, or the whole
 * branch). Local review comments (SQLite) attach to the file/line here and are
 * clearly labelled as Ensemble-local, never GitHub state.
 */
export function WorkspaceFileDiffPanel({
	filePath,
	scope,
	workspaceCwd,
	workspaceId,
}: {
	filePath: string | null;
	scope?: WorkspaceGitDiffScope;
	workspaceCwd: string | null;
	workspaceId: string;
}) {
	const { data, isError, isPending } = useQuery(
		workspaceFileDiffQuery({ filePath, scope, workspaceCwd }),
	);
	const insertIntoComposer = useComposerInsert();

	if (!filePath) {
		return <DiffMessage message='This tab has no file associated.' />;
	}
	if (isPending) {
		return <DiffMessage message='Loading diff…' />;
	}
	if (isError) {
		return <DiffMessage message='Could not load diff.' tone='error' />;
	}

	const result = data;
	if (result.error) {
		return <DiffMessage message={result.error.message} tone='error' />;
	}

	return (
		<div className='flex min-h-0 flex-1 flex-col overflow-hidden'>
			<div className='flex h-9 shrink-0 items-center gap-2 border-border border-b bg-muted/30 px-4'>
				<FileDiffIcon
					aria-hidden='true'
					className='size-3.5 shrink-0 text-muted-foreground'
				/>
				<span className='truncate font-mono text-muted-foreground text-xs'>
					{result.path}
				</span>
				{result.isTruncated ? (
					<span className='shrink-0 text-status-warning text-xs'>
						Diff truncated
					</span>
				) : null}
				{result.patch ? (
					<Button
						className='ml-auto h-6 px-1.5 text-xs'
						onClick={() => {
							insertIntoComposer(
								formatFileDiffContext({
									filePath: result.path,
									patch: result.patch ?? '',
								}),
							);
							toast.success('Diff added to chat.');
						}}
						size='xs'
						variant='ghost'
					>
						<MessageSquarePlusIcon data-icon='inline-start' />
						Add to chat
					</Button>
				) : null}
			</div>
			<div className='min-h-0 flex-1 overflow-auto'>
				{result.patch ? (
					<CodeBlockContent
						code={result.patch}
						language={'diff' as BundledLanguage}
					/>
				) : (
					<DiffMessage message='No changes in this file.' />
				)}
				<FileCommentSection filePath={result.path} workspaceId={workspaceId} />
			</div>
		</div>
	);
}

function DiffMessage({
	message,
	tone = 'muted',
}: {
	message: string;
	tone?: 'error' | 'muted';
}) {
	return (
		<div className='flex min-h-24 flex-1 items-center justify-center p-6'>
			<div className='flex items-center gap-2 text-sm'>
				{tone === 'error' ? (
					<TriangleAlertIcon
						aria-hidden='true'
						className='size-4 shrink-0 text-destructive'
					/>
				) : null}
				<span
					className={
						tone === 'error' ? 'text-destructive' : 'text-muted-foreground'
					}
				>
					{message}
				</span>
			</div>
		</div>
	);
}
