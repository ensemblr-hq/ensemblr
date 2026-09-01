import { useQuery } from '@tanstack/react-query';

import {
	agentSessionsForWorkspaceQuery,
	listClosedChatTabsWithSummaryQuery,
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
 * Scrollable timeline content shown above the composer.
 *
 * Three mutually-exclusive states:
 *   1. Active agent session, or a prompt already submitted into one that is
 *      still opening — render `AgentSessionTimeline` with events.
 *   2. No session, but the workspace has been worked in — render
 *      `NewChatEmptyState`, with a chip for each `.context/sessions` transcript.
 *   3. No session and an untouched workspace — render `WorkspaceLandingCard`
 *      (fresh workspace summary), falling back to `NewChatEmptyState`.
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
		listClosedChatTabsWithSummaryQuery(workspace.id),
	);
	const { data: agentSessionsData } = useQuery(
		agentSessionsForWorkspaceQuery(workspace.id),
	);
	// The closed-history query lists every restorable tab, including terminal
	// tabs no transcript is ever written for. Chats are the ones this surface can
	// speak to: one whose summary file is missing is shown disabled rather than
	// dropped, so a gap reads as a gap instead of as a workspace with no history.
	const transcripts = (transcriptsData?.entries ?? []).filter(
		(entry) => entry.tab.kind === 'chat',
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

	// The card claims nothing has happened in this workspace yet, so every trace
	// of prior work has to count — a sibling chat tab's session, a closed tab's
	// transcript, or edits made straight from a terminal. An unloaded session
	// list counts as history too: guessing "untouched" before it lands is the one
	// answer that can be wrong, and the neutral empty state is right either way.
	const hasWorkspaceHistory =
		agentSessionsData === undefined ||
		agentSessionsData.sessions.length > 0 ||
		hasAttachableTranscript ||
		workspace.changeSummary.files > 0;
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
