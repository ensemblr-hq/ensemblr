import { useQuery } from '@tanstack/react-query';

import {
	agentSessionsForWorkspaceQuery,
	listChatTabSummariesQuery,
	workspaceGitStatusQuery,
} from '@/renderer/api/ensemblr-queries';
import { useHasPendingPrompts } from '@/renderer/state/composer';
import type {
	ComposerShellState,
	SessionTabModel,
	WorkspaceShellModel,
} from '@/renderer/types/workbench';

import { NewChatEmptyState } from './new-chat-empty-state';
import { AgentSessionTimeline } from './timeline/timeline';
import { WorkspaceLandingCard } from './workspace-landing-card';

/**
 * Directories Ensemblr writes into a workspace itself: the seed architecture
 * scan and the committed repository settings under one, the agent's plans,
 * transcripts, and prompt attachments under the other. A change under either is
 * the app's own bookkeeping rather than work the user did.
 */
const APP_OWNED_PREFIXES = ['.ensemblr/', '.context/'] as const;

/**
 * How many changed files the *user* is responsible for.
 * @param paths - Every changed path git reports, or null before the read lands
 * @param fallbackCount - The workspace model's own count, used until it does
 * @returns The count the landing-card gate reads
 */
function countUserChangedFiles(
	paths: readonly string[] | null,
	fallbackCount: number,
): number {
	if (!paths) {
		return fallbackCount;
	}
	return paths.filter(
		(path) => !APP_OWNED_PREFIXES.some((prefix) => path.startsWith(prefix)),
	).length;
}

/**
 * Scrollable timeline content shown above the composer.
 *
 * Three mutually-exclusive states:
 *   1. Active agent session, or a prompt already submitted into one that is
 *      still opening — render `AgentSessionTimeline` with events.
 *   2. No session, but the workspace has been chatted in before — render
 *      `NewChatEmptyState`, with a chip for each sibling chat's
 *      `.context/sessions` transcript, open chats included.
 *   3. No session and no prior chat — render `WorkspaceLandingCard` (fresh
 *      workspace summary), falling back to `NewChatEmptyState`.
 *
 * Setup / diagnostic / readiness UI lives in the sidebar footer and the
 * settings → diagnostics screen — it never appears inside the conversation
 * surface.
 */
export function WorkspaceTimeline({
	activeSession,
	composer,
	workspace,
}: {
	activeSession: SessionTabModel;
	composer: ComposerShellState;
	workspace: WorkspaceShellModel;
}) {
	const agentSessionId =
		activeSession.agentSessionId ?? composer.activeAgentSessionId ?? null;
	// A chat's first prompt is submitted before its session exists — opening one
	// costs a runtime spawn, seconds on a cold Claude start. Widening the branch
	// on the raw flag is safe only because a prompt retires against a persisted
	// event, which implies a resolved session: `agentSessionId` is already true
	// for every prompt this flag drops, so the branch never narrows underneath a
	// timeline that still has something to render.
	const hasPendingPrompt = useHasPendingPrompts(activeSession.chatTabId);
	const { data: transcriptsData } = useQuery(
		listChatTabSummariesQuery(workspace.id),
	);
	const { data: agentSessionsData } = useQuery(
		agentSessionsForWorkspaceQuery(workspace.id),
	);
	// The same query the workspace model derives `changeSummary` from, so reading
	// it here costs a cache hit rather than a second poll.
	const { data: gitStatusData } = useQuery(
		workspaceGitStatusQuery(composer.workspaceCwd || null),
	);
	// The summary query lists every restorable tab, including terminal tabs no
	// transcript is ever written for. Chats are the ones this surface can speak
	// to, minus this tab itself — attaching a chat's own transcript to itself says
	// nothing. A closed chat whose summary file is missing is shown disabled
	// rather than dropped, so a gap reads as a gap instead of as a workspace with
	// no history.
	const transcripts = (transcriptsData?.entries ?? []).filter(
		(entry) =>
			entry.tab.kind === 'chat' && entry.tab.id !== activeSession.chatTabId,
	);
	const hasAttachableTranscript = transcripts.some(
		(entry) => entry.summaryPath.length > 0,
	);

	if (agentSessionId || hasPendingPrompt) {
		return (
			<div className='flex min-h-0 flex-1 flex-col'>
				<AgentSessionTimeline
					activeAgentSessionId={composer.activeAgentSessionId}
					activeSession={activeSession}
					workspace={workspace}
				/>
			</div>
		);
	}

	// A workspace the app has just cut is already dirty — it writes the seed
	// architecture scan into it — so the dirty-worktree signal counts only the
	// files outside the directories the app writes.
	const userChangedFiles = countUserChangedFiles(
		gitStatusData && !gitStatusData.error
			? gitStatusData.files.map((file) => file.path)
			: null,
		workspace.changeSummary.files,
	);
	// An unloaded session list counts as history: guessing "untouched" before it
	// lands is the one answer that can be wrong, and the neutral empty state is
	// right either way.
	const hasWorkspaceHistory =
		agentSessionsData === undefined ||
		agentSessionsData.sessions.length > 0 ||
		hasAttachableTranscript ||
		userChangedFiles > 0;
	const showLandingCard =
		!hasWorkspaceHistory && Boolean(workspace.landingSummary);

	return (
		<div className='flex min-h-0 flex-1 flex-col'>
			<div className='mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-5'>
				{showLandingCard ? (
					<WorkspaceLandingCard landingSummary={workspace.landingSummary} />
				) : (
					<NewChatEmptyState
						activeChatTabId={activeSession.chatTabId}
						transcripts={transcripts}
						workspaceCwd={composer.workspaceCwd}
						workspaceName={workspace.name}
					/>
				)}
			</div>
		</div>
	);
}
