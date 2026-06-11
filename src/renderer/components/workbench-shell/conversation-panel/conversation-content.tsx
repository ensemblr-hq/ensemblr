import { usePiRawFrameCapture } from '@/renderer/state/pi-raw-frames';
import type {
	ComposerShellState,
	SessionTabModel,
	WorkspaceShellModel,
} from '@/renderer/types/workbench';

import { ComposerPanel } from './composer-panel';
import { PiRawFramePanel } from './pi-raw-frame-panel';
import { SessionTabs } from './session-tabs';
import { WorkspaceTimeline } from './workspace-timeline';

/**
 * Conversation surface — session tabs, scrollable timeline, and composer.
 *
 * The `Conversation` primitive owns its own scroll viewport (sticky-to-bottom),
 * so the surrounding container is a flex column with overflow hidden — the
 * timeline child manages its own scrolling.
 */
export function WorkspaceConversationContent({
	activeSession,
	activeWorkspace,
	closedSessions,
	composer,
	onSessionTabChange,
	onSessionTabClose,
	onSessionTabOpen,
	onSessionTabRestore,
	sessionTabs,
}: {
	activeSession: SessionTabModel;
	activeWorkspace: WorkspaceShellModel;
	closedSessions: SessionTabModel[];
	composer: ComposerShellState;
	onSessionTabChange: (sessionId: string) => void;
	onSessionTabClose: (sessionId: string) => void;
	onSessionTabOpen: () => Promise<{ chatTabId: string } | null>;
	onSessionTabRestore: (sessionId: string) => void;
	sessionTabs: SessionTabModel[];
}) {
	// Capture every raw Pi RPC frame into the debug ring buffer. The panel may
	// be closed; capture still runs so the user can open the panel after the
	// fact and see what already happened.
	usePiRawFrameCapture();
	const debugSessionId =
		activeSession.piSessionId ?? composer.activePiSessionId ?? null;
	return (
		<section className='relative flex min-h-0 flex-1 flex-col overflow-hidden'>
			<SessionTabs
				activeSession={activeSession}
				closedSessions={closedSessions}
				onSessionTabClose={onSessionTabClose}
				onSessionTabChange={onSessionTabChange}
				onSessionTabOpen={onSessionTabOpen}
				onSessionTabRestore={onSessionTabRestore}
				sessions={sessionTabs}
			/>
			<div className='flex min-h-0 flex-1 flex-col overflow-hidden'>
				<WorkspaceTimeline
					activeSession={activeSession}
					composer={composer}
					workspace={activeWorkspace}
				/>
			</div>
			<ComposerPanel chatTabId={activeSession.chatTabId} composer={composer} />
			<PiRawFramePanel sessionId={debugSessionId} />
		</section>
	);
}
