import { ScrollArea } from '@/renderer/components/ui/scroll-area';
import type {
	ComposerShellState,
	SessionTabModel,
	WorkspaceShellModel,
} from '@/renderer/types/workbench';

import { ComposerPanel } from './composer-panel';
import { SessionTabs } from './session-tabs';
import { WorkspaceTimeline } from './workspace-timeline';

/** Conversation surface — session tabs, scrollable timeline, and composer. */
export function WorkspaceConversationContent({
	activeSession,
	activeWorkspace,
	closedSessions,
	composer,
	onSessionTabChange,
	onSessionTabClose,
	onSessionTabRestore,
	sessionTabs,
}: {
	activeSession: SessionTabModel;
	activeWorkspace: WorkspaceShellModel;
	closedSessions: SessionTabModel[];
	composer: ComposerShellState;
	onSessionTabChange: (sessionId: string) => void;
	onSessionTabClose: (sessionId: string) => void;
	onSessionTabRestore: (sessionId: string) => void;
	sessionTabs: SessionTabModel[];
}) {
	return (
		<section className='flex min-h-0 flex-1 flex-col overflow-hidden'>
			<SessionTabs
				activeSession={activeSession}
				closedSessions={closedSessions}
				onSessionTabClose={onSessionTabClose}
				onSessionTabChange={onSessionTabChange}
				onSessionTabRestore={onSessionTabRestore}
				sessions={sessionTabs}
			/>
			<ScrollArea className='min-h-0 flex-1'>
				<WorkspaceTimeline
					activeSession={activeSession}
					composer={composer}
					workspace={activeWorkspace}
				/>
			</ScrollArea>
			<ComposerPanel composer={composer} />
		</section>
	);
}
