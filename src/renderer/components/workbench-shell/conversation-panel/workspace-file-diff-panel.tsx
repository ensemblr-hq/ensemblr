import { useQuery } from '@tanstack/react-query';
import { ChevronDownIcon } from 'lucide-react';
import { useMemo } from 'react';
import { toast } from 'sonner';

import {
	listChatTabsQuery,
	pullRequestSnapshotQuery,
	reviewCommentsQuery,
} from '@/renderer/api/ensemblr-queries';
import { DiffViewer } from '@/renderer/components/diff-viewer';
import { Button } from '@/renderer/components/ui/button';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuTrigger,
} from '@/renderer/components/ui/dropdown-menu';
import { OpenInToolbarMenu } from '@/renderer/components/workbench-shell/open-in-toolbar-menu';
import { useDiffCommentMutations } from '@/renderer/hooks/workbench-shell/conversation-panel/use-diff-comment-mutations';
import { useFileDiffContent } from '@/renderer/hooks/workbench-shell/conversation-panel/use-file-diff-content';
import { useFileViewedMark } from '@/renderer/hooks/workbench-shell/conversation-panel/use-file-viewed-mark';
import { parseSingleFileDiff } from '@/renderer/lib/diff/parse';
import { groupDiffComments } from '@/renderer/lib/workbench/diff-comments';
import { formatFileDiffContext } from '@/renderer/lib/workbench/review-context';
import {
	useComposerInsertToChat,
	useRequestComposerFocus,
} from '@/renderer/state/composer';
import {
	useDiffLineReveal,
	useSettleDiffLineReveal,
} from '@/renderer/state/workspace';
import type { ChatTabWire } from '@/shared/ipc/contracts/chat-tab';
import type { WorkspaceGitDiffScope } from '@/shared/ipc/contracts/workspace-git';

import { PanelMessage } from './panel-message';

/** Stable empty list so an absent comment source keeps a fixed array identity. */
const EMPTY_LIST: readonly never[] = [];

/**
 * Rich single-file diff surface for a `kind: 'diff'` tab that carries a
 * `filePath`. Renders the unified patch through the shared {@link DiffViewer}
 * with line numbers, inline comments (Ensemblr-local, editable; GitHub review
 * threads and Action-bot comments, read-only), diff/full-file, split,
 * whitespace, and word-wrap toggles, and a Viewed marker that dims the file and
 * sends it to the end of the Changes list. The optional `scope` selects the diff
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
	const { data: commentsData } = useQuery(reviewCommentsQuery(workspaceId));
	const { data: snapshotData } = useQuery(
		pullRequestSnapshotQuery({ workspaceCwd, workspaceId }),
	);
	const {
		fullFileContent,
		fullFileContentPending,
		isTruncated,
		patch,
		placeholder,
		resolvedPath,
	} = useFileDiffContent({ filePath, scope, workspaceCwd });

	const { onViewedChange, viewed } = useFileViewedMark({
		filePath: resolvedPath,
		scope,
		workspaceCwd,
		workspaceId,
	});
	const reveal = useDiffLineReveal(resolvedPath, workspaceId);
	const settleReveal = useSettleDiffLineReveal();
	const { onAddComment, onDeleteComment, onResolveComment } =
		useDiffCommentMutations({ filePath: resolvedPath, workspaceId });

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

	if (placeholder) {
		return (
			<PanelMessage message={placeholder.message} tone={placeholder.tone} />
		);
	}

	return (
		<DiffViewer
			commentsByChangeKey={commentsByChangeKey}
			filePath={resolvedPath}
			fullFileContent={fullFileContent}
			fullFileContentPending={fullFileContentPending}
			headerActions={
				<>
					{isTruncated ? (
						<span className='text-status-warning text-xs'>Diff truncated</span>
					) : null}
					<AddToChatMenu
						filePath={resolvedPath}
						onSelectChat={onSelectChat}
						patch={patch}
						workspaceId={workspaceId}
					/>
					<OpenInToolbarMenu
						filePath={resolvedPath}
						workspaceId={workspaceId}
					/>
				</>
			}
			onAddComment={onAddComment}
			onDeleteComment={onDeleteComment}
			onResolveComment={onResolveComment}
			onRevealSettled={settleReveal}
			onViewedChange={onViewedChange}
			patch={patch}
			reveal={reveal}
			viewed={viewed}
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
				Add to chat
			</Button>
		);
	}

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button className='h-6 px-1.5 text-xs' size='xs' variant='ghost'>
					Add to chat
					<ChevronDownIcon data-icon='inline-end' />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align='end' className='w-56 bg-muted p-1'>
				<DropdownMenuLabel className='px-2'>Add diff to chat</DropdownMenuLabel>
				{chats.map((tab, index) => (
					<DropdownMenuItem
						className='h-8 gap-2.5 px-2 text-[0.8125rem]'
						key={tab.id}
						onSelect={() => addToChat(tab)}
					>
						<span className='min-w-0 flex-1 truncate'>
							{tab.title || 'Untitled chat'}
						</span>
						{index === 0 ? (
							<span className='shrink-0 text-muted-foreground text-xs'>
								latest
							</span>
						) : null}
					</DropdownMenuItem>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
