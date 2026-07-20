import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
	ChevronDownIcon,
	MessageSquarePlusIcon,
	TriangleAlertIcon,
} from 'lucide-react';
import { useMemo } from 'react';
import { toast } from 'sonner';

import {
	deleteReviewComment,
	ensemblrQueryKeys,
	listChatTabsQuery,
	pullRequestSnapshotQuery,
	readWorkspaceFile,
	reviewCommentsQuery,
	saveReviewComment,
	workspaceFileDiffQuery,
} from '@/renderer/api/ensemblr-queries';
import { DiffViewer } from '@/renderer/components/diff-viewer';
import { parseSingleFileDiff } from '@/renderer/components/diff-viewer/parse';
import { Button } from '@/renderer/components/ui/button';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuTrigger,
} from '@/renderer/components/ui/dropdown-menu';
import { groupDiffComments } from '@/renderer/lib/workbench/diff-comments';
import { formatFileDiffContext } from '@/renderer/lib/workbench/review-context';
import {
	useComposerInsertToChat,
	useRequestComposerFocus,
} from '@/renderer/state/composer';
import type { ChatTabWire } from '@/shared/ipc/contracts/chat-tab';
import type { WorkspaceGitDiffScope } from '@/shared/ipc/contracts/workspace-git';

const LOCAL_ID_PREFIX = 'local:';

/** Stable empty list so an absent comment source keeps a fixed array identity. */
const EMPTY_LIST: readonly never[] = [];

/**
 * Whether a diff scope's new side is the on-disk working tree, which is what the
 * full-file view reconstructs from. Both the working-tree scope and a branch
 * diff qualify: git takes a branch diff (`merge-base…`) against the live
 * worktree, so the current file is its new side. A commit diff's new side is a
 * historical ref, not the worktree, so its full file cannot be read from disk.
 * @param scope - The diff scope, or undefined for the default working-tree diff
 * @returns True when the working-tree file is the diff's new side
 */
export function diffNewSideIsWorkingTree(
	scope: WorkspaceGitDiffScope | undefined,
): boolean {
	return !scope || scope.kind === 'working-tree' || scope.kind === 'branch';
}

/**
 * Strip the `local:` prefix from a diff comment id, returning the underlying
 * local review-comment id, or null for non-local (read-only GitHub) comments.
 * @param id - The diff comment id
 * @returns The local review-comment id, or null
 */
function localCommentId(id: string): string | null {
	return id.startsWith(LOCAL_ID_PREFIX)
		? id.slice(LOCAL_ID_PREFIX.length)
		: null;
}

/**
 * Rich single-file diff surface for a `kind: 'diff'` tab that carries a
 * `filePath`. Renders the unified patch through the shared {@link DiffViewer}
 * with line numbers, inline comments (Ensemblr-local, editable; GitHub review
 * threads and Action-bot comments, read-only), and diff/full-file, split,
 * whitespace, and word-wrap toggles. The optional `scope` selects the diff
 * (working tree by default, a commit, or the whole branch).
 */
export function WorkspaceFileDiffPanel({
	filePath,
	onSelectChat,
	scope,
	workspaceCwd,
	workspaceId,
}: {
	filePath: string | null;
	/** Routes the user to a chat tab after the diff is added to it. */
	onSelectChat: (chatTabId: string) => void;
	scope?: WorkspaceGitDiffScope;
	workspaceCwd: string | null;
	workspaceId: string;
}) {
	const queryClient = useQueryClient();
	const newSideIsWorkingTree = diffNewSideIsWorkingTree(scope);

	const diff = useQuery(
		workspaceFileDiffQuery({ filePath, scope, workspaceCwd }),
	);
	const { data: commentsData } = useQuery(reviewCommentsQuery(workspaceId));
	const { data: snapshotData } = useQuery(
		pullRequestSnapshotQuery({ workspaceCwd, workspaceId }),
	);
	const resolvedPath =
		diff.data && !diff.data.error ? diff.data.path : (filePath ?? '');
	const { data: fileData } = useQuery({
		enabled: newSideIsWorkingTree && Boolean(resolvedPath && workspaceCwd),
		queryFn: () =>
			readWorkspaceFile({
				path: resolvedPath,
				workspaceCwd: workspaceCwd ?? '',
			}),
		queryKey: ensemblrQueryKeys.filePreview(workspaceCwd ?? '', resolvedPath),
		staleTime: 10_000,
	});

	const invalidateComments = () =>
		queryClient.invalidateQueries({
			queryKey: ensemblrQueryKeys.reviewComments(workspaceId),
		});

	const addMutation = useMutation({
		mutationFn: (input: { body: string; lineNumber: number | null }) =>
			saveReviewComment({
				body: input.body,
				filePath: resolvedPath,
				lineNumber: input.lineNumber,
				workspaceId,
			}),
		onError: notifyCommentFailed,
		onSuccess: invalidateComments,
	});
	const resolveMutation = useMutation({
		mutationFn: (input: { id: string; resolved: boolean }) =>
			saveReviewComment({
				id: input.id,
				status: input.resolved ? 'resolved' : 'open',
				workspaceId,
			}),
		onError: notifyCommentFailed,
		onSuccess: invalidateComments,
	});
	const deleteMutation = useMutation({
		mutationFn: (id: string) => deleteReviewComment({ id }),
		onError: notifyCommentFailed,
		onSuccess: invalidateComments,
	});

	const patch = diff.data && !diff.data.error ? (diff.data.patch ?? '') : '';
	const githubComments =
		snapshotData?.snapshot?.pullRequest?.comments ?? EMPTY_LIST;
	const localComments = commentsData?.comments ?? EMPTY_LIST;

	const commentsByChangeKey = useMemo(() => {
		const file = parseSingleFileDiff(patch);
		return groupDiffComments({
			filePath: resolvedPath,
			githubComments,
			hunks: file?.hunks ?? [],
			localComments,
		}).byChangeKey;
	}, [patch, resolvedPath, githubComments, localComments]);

	if (!filePath) {
		return <DiffMessage message='This tab has no file associated.' />;
	}
	if (diff.isPending) {
		return <DiffMessage message='Loading diff…' />;
	}
	if (diff.isError) {
		return <DiffMessage message='Could not load diff.' tone='error' />;
	}
	if (diff.data.error) {
		return <DiffMessage message={diff.data.error.message} tone='error' />;
	}
	if (!patch) {
		return <DiffMessage message='No changes in this file.' />;
	}

	const fullFileContent =
		fileData && !fileData.error ? (fileData.content ?? null) : null;

	return (
		<DiffViewer
			commentsByChangeKey={commentsByChangeKey}
			filePath={resolvedPath}
			fullFileContent={fullFileContent}
			headerActions={
				<>
					{diff.data.isTruncated ? (
						<span className='text-status-warning text-xs'>Diff truncated</span>
					) : null}
					<AddToChatMenu
						filePath={resolvedPath}
						onSelectChat={onSelectChat}
						patch={patch}
						workspaceId={workspaceId}
					/>
				</>
			}
			onAddComment={({ body, lineNumber }) =>
				addMutation.mutate({ body, lineNumber })
			}
			onDeleteComment={(id) => {
				const local = localCommentId(id);
				if (local) {
					deleteMutation.mutate(local);
				}
			}}
			onResolveComment={(id, resolved) => {
				const local = localCommentId(id);
				if (local) {
					resolveMutation.mutate({ id: local, resolved });
				}
			}}
			patch={patch}
		/>
	);
}

/**
 * "Add to chat" control for the diff header. Lists the workspace's open chat
 * tabs so the user picks exactly which chat the diff context lands in (the
 * most-recently-opened chat is offered first as the default). With a single
 * open chat it collapses to a one-click button; the diff is appended to the
 * chosen chat's draft even when that chat is not the active tab.
 */
function AddToChatMenu({
	filePath,
	onSelectChat,
	patch,
	workspaceId,
}: {
	filePath: string;
	onSelectChat: (chatTabId: string) => void;
	patch: string;
	workspaceId: string;
}) {
	const insertToChat = useComposerInsertToChat();
	const requestComposerFocus = useRequestComposerFocus();
	const { data } = useQuery(listChatTabsQuery(workspaceId));

	// Newest chat first: the last-opened tab is the default "add here" target.
	const chats = useMemo(
		() => (data?.open ?? []).filter((tab) => tab.kind === 'chat').reverse(),
		[data],
	);

	const addToChat = (tab: ChatTabWire) => {
		insertToChat(tab.id, formatFileDiffContext({ filePath, patch }));
		toast.success(`Diff added to ${tab.title || 'chat'}.`);
		onSelectChat(tab.id);
		requestComposerFocus(tab.id);
	};

	if (chats.length === 0) {
		return null;
	}

	if (chats.length === 1) {
		return (
			<Button
				className='h-6 px-1.5 text-xs'
				onClick={() => addToChat(chats[0])}
				size='xs'
				variant='ghost'
			>
				<MessageSquarePlusIcon data-icon='inline-start' />
				Add to chat
			</Button>
		);
	}

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button className='h-6 px-1.5 text-xs' size='xs' variant='ghost'>
					<MessageSquarePlusIcon data-icon='inline-start' />
					Add to chat
					<ChevronDownIcon data-icon='inline-end' />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align='end' className='max-w-64'>
				<DropdownMenuLabel>Add diff to chat</DropdownMenuLabel>
				{chats.map((tab, index) => (
					<DropdownMenuItem key={tab.id} onSelect={() => addToChat(tab)}>
						<span className='truncate'>{tab.title || 'Untitled chat'}</span>
						{index === 0 ? (
							<span className='ml-auto text-muted-foreground text-xs'>
								latest
							</span>
						) : null}
					</DropdownMenuItem>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

/**
 * Show an error toast when a local review-comment mutation fails.
 * @param error - The thrown error, if any
 */
function notifyCommentFailed(error: unknown): void {
	toast.error('Comment update failed', {
		description: error instanceof Error ? error.message : undefined,
	});
}

/** Renders a centered muted or error message inside the workspace file-diff panel. */
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
