import { useQuery } from '@tanstack/react-query';

import { listClosedChatTabsWithSummaryQuery } from '@/renderer/api/ensemble-queries';
import type {
	ComposerShellState,
	SessionTabModel,
	WorkspaceShellModel,
} from '@/renderer/types/workbench';

import { NewChatEmptyState } from './new-chat-empty-state';
import { PiSessionTimeline } from './timeline/timeline';
import { WorkspaceLandingCard } from './workspace-landing-card';

/**
 * Scrollable timeline content shown above the composer.
 *
 * Three mutually-exclusive states:
 *   1. Active Pi session — render `PiSessionTimeline` with events.
 *   2. No session, transcripts exist — render `NewChatEmptyState` with chips
 *      for each `.context/sessions` transcript.
 *   3. No session, no transcripts — render `WorkspaceLandingCard` (fresh
 *      workspace summary) or a bare `NewChatEmptyState` as fallback.
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
	const piSessionId =
		activeSession.piSessionId ?? composer.activePiSessionId ?? null;
	const transcriptsQuery = useQuery(
		listClosedChatTabsWithSummaryQuery(workspace.id),
	);
	const transcripts = transcriptsQuery.data?.entries ?? [];

	if (piSessionId) {
		return (
			<div className='flex min-h-0 flex-1 flex-col'>
				<PiSessionTimeline
					activePiSessionId={composer.activePiSessionId}
					activeSession={activeSession}
					workspace={workspace}
				/>
			</div>
		);
	}

	const showLandingCard =
		transcripts.length === 0 && Boolean(workspace.landingSummary);

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
