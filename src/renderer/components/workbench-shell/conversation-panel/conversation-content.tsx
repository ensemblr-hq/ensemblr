import { useAtomValue } from 'jotai';
import { XtermTerminal } from '@/renderer/components/workbench-shell/dock-panel/xterm-terminal';
import { useConversationOpeners } from '@/renderer/hooks/workbench-shell/conversation-panel/use-conversation-openers';
import { useLinkedIssueComposerSeed } from '@/renderer/hooks/workspace/use-linked-issue-composer-seed';
import type { createWorkspacePathResolver } from '@/renderer/lib/agent-timeline';
import { showsComposer } from '@/renderer/lib/workbench';
import { usePiRawFrameCapture } from '@/renderer/state/pi';
import { developerModeAtom } from '@/renderer/state/preferences';
import { useWorkspaceUnreadKeys } from '@/renderer/state/unread';
import type {
	ComposerShellState,
	SessionTabModel,
	WorkspaceShellModel,
} from '@/renderer/types/workbench';
import type { SessionTabPlacement } from '@/renderer/types/workbench-shell';
import { CommentPreviewPanel } from './comment-preview-panel';
import { ComposerSlot } from './composer-slot';
import {
	FilePreviewOpenerProvider,
	TurnDiffOpenerProvider,
	WorkspacePathResolverProvider,
} from './file-preview-context';
import { FilePreviewPanel } from './file-preview-panel';
import { PiRawFramePanel } from './pi-raw-frame-panel';
import { SessionTabs } from './session-tabs';
import { SubAgentStatusPanel } from './sub-agent-status-panel';
import { TurnDiffPanel } from './turn-diff-panel';
import { WorkspaceFileDiffPanel } from './workspace-file-diff-panel';
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
	onDirectoryReveal,
	onFilePreviewOpen,
	onLaunchHarness,
	onSessionTabChange,
	onSessionTabClose,
	onSessionTabOpen,
	onSessionTabPin,
	onSessionTabRestore,
	onSessionTabsReorder,
	onTurnDiffOpen,
	sessionTabs,
}: {
	activeSession: SessionTabModel;
	activeWorkspace: WorkspaceShellModel;
	closedSessions: SessionTabModel[];
	composer: ComposerShellState;
	onDirectoryReveal: (directoryPath: string) => void;
	onFilePreviewOpen: (input: {
		filePath: string;
	}) => Promise<{ chatTabId: string } | null>;
	onLaunchHarness: (input: {
		harnessId: string;
		harnessLabel: string;
	}) => Promise<{ chatTabId: string } | null>;
	onTurnDiffOpen: (input: {
		label: string;
		turnId: string;
	}) => Promise<{ chatTabId: string } | null>;
	onSessionTabChange: (sessionId: string) => void;
	onSessionTabClose: (sessionId: string) => void;
	onSessionTabOpen: (options?: {
		placement?: SessionTabPlacement;
	}) => Promise<{ chatTabId: string } | null>;
	onSessionTabPin: (sessionId: string) => void;
	onSessionTabRestore: (sessionId: string) => void;
	onSessionTabsReorder: (
		sessionIds: string[],
		draggedSessionId: string,
	) => void;
	sessionTabs: SessionTabModel[];
}) {
	const developerMode = useAtomValue(developerModeAtom);
	usePiRawFrameCapture(developerMode);
	const debugSessionId =
		activeSession.agentSessionId ?? composer.activeAgentSessionId ?? null;
	const isChatTab = (activeSession.kind ?? 'chat') === 'chat';
	const unreadKeys = useWorkspaceUnreadKeys(activeWorkspace.id);

	const { openFilePreview, openTurnDiff, resolveWorkspacePath } =
		useConversationOpeners({
			activeWorkspace,
			onDirectoryReveal,
			onFilePreviewOpen,
			onSessionTabChange,
			onTurnDiffOpen,
		});

	return (
		<section className='relative flex min-h-0 flex-1 flex-col overflow-hidden'>
			<SessionTabs
				activeSession={activeSession}
				closedSessions={closedSessions}
				onLaunchHarness={onLaunchHarness}
				onSessionTabClose={onSessionTabClose}
				onSessionTabChange={onSessionTabChange}
				onSessionTabOpen={onSessionTabOpen}
				onSessionTabPin={onSessionTabPin}
				onSessionTabRestore={onSessionTabRestore}
				onSessionTabsReorder={onSessionTabsReorder}
				sessions={sessionTabs}
				unreadKeys={unreadKeys}
			/>
			{isChatTab ? (
				<ChatTabBody
					activeSession={activeSession}
					activeWorkspace={activeWorkspace}
					composer={composer}
					openFilePreview={openFilePreview}
					openTurnDiff={openTurnDiff}
					resolveWorkspacePath={resolveWorkspacePath}
				/>
			) : (
				<ActiveAuxiliaryPanel
					activeSession={activeSession}
					activeWorkspace={activeWorkspace}
					onSessionTabChange={onSessionTabChange}
				/>
			)}
			{developerMode ? <PiRawFramePanel sessionId={debugSessionId} /> : null}
		</section>
	);
}

/** Options a chat tab's body needs to render its timeline and composer. */
interface ChatTabBodyProps {
	activeSession: SessionTabModel;
	activeWorkspace: WorkspaceShellModel;
	composer: ComposerShellState;
	openFilePreview: (filePath: string) => void;
	openTurnDiff: (input: { label: string; turnId: string }) => void;
	resolveWorkspacePath: ReturnType<typeof createWorkspacePathResolver>;
}

/**
 * Renders a chat tab's timeline and composer under the path-resolution and
 * preview-opener context the conversation surface provides. A tab that gets no
 * composer is a spawned sub-agent's — the only case `showsComposer` refuses —
 * so its runtime readout takes the slot the composer would have occupied.
 */
function ChatTabBody({
	activeSession,
	activeWorkspace,
	composer,
	openFilePreview,
	openTurnDiff,
	resolveWorkspacePath,
}: ChatTabBodyProps) {
	return (
		<WorkspacePathResolverProvider value={resolveWorkspacePath}>
			<FilePreviewOpenerProvider value={openFilePreview}>
				<TurnDiffOpenerProvider value={openTurnDiff}>
					<div className='flex min-h-0 flex-1 flex-col overflow-hidden'>
						<WorkspaceTimeline
							activeSession={activeSession}
							composer={composer}
							workspace={activeWorkspace}
						/>
					</div>
					{showsComposer(activeSession) ? (
						<LinkedIssueComposerSlot
							activeSession={activeSession}
							activeWorkspace={activeWorkspace}
							composer={composer}
						/>
					) : (
						<SubAgentStatusPanel composer={composer} />
					)}
				</TurnDiffOpenerProvider>
			</FilePreviewOpenerProvider>
		</WorkspacePathResolverProvider>
	);
}

/**
 * Renders the panel for a non-chat session tab (terminal, diff, document, or
 * file). Split out of `WorkspaceConversationContent` so the per-kind branching
 * lives in one focused component instead of inflating the parent's complexity.
 */
function ActiveAuxiliaryPanel({
	activeSession,
	activeWorkspace,
	onSessionTabChange,
}: {
	activeSession: SessionTabModel;
	activeWorkspace: WorkspaceShellModel;
	onSessionTabChange: (sessionId: string) => void;
}) {
	if (activeSession.kind === 'terminal') {
		return (
			<div className='flex min-h-0 flex-1'>
				<XtermTerminal
					sessionStatus={null}
					terminalId={activeSession.terminalId}
					terminalLabel={activeSession.fullLabel ?? activeSession.label}
					workspaceCwd={activeWorkspace.pathLabel}
				/>
			</div>
		);
	}
	if (activeSession.kind === 'diff') {
		return activeSession.filePath ? (
			<WorkspaceFileDiffPanel
				filePath={activeSession.filePath}
				onSelectChat={onSessionTabChange}
				scope={activeSession.diffScope ?? undefined}
				workspaceCwd={activeWorkspace.pathLabel ?? null}
				workspaceId={activeWorkspace.id}
			/>
		) : (
			<TurnDiffPanel turnId={activeSession.turnId ?? null} />
		);
	}
	if (activeSession.kind === 'document' && activeSession.commentPreview) {
		return (
			<CommentPreviewPanel
				comment={activeSession.commentPreview}
				workspaceCwd={activeWorkspace.pathLabel}
			/>
		);
	}
	return (
		<FilePreviewPanel
			filePath={activeSession.filePath ?? null}
			workspaceCwd={activeWorkspace.pathLabel ?? null}
			workspaceId={activeWorkspace.id}
		/>
	);
}

/**
 * The composer for a chat, seeded from the workspace's linked issue while that
 * issue is still waiting for its first conversation. Split out so the seed reads
 * the workspace-wide gate once here rather than inline in the tree.
 */
function LinkedIssueComposerSlot({
	activeSession,
	activeWorkspace,
	composer,
}: {
	activeSession: SessionTabModel;
	activeWorkspace: WorkspaceShellModel;
	composer: ComposerShellState;
}) {
	const agentSessionId = activeSession.agentSessionId ?? null;
	const seedLinkedIssue = useLinkedIssueComposerSeed({
		agentSessionId,
		linkedIssue: activeWorkspace.landingSummary?.linkedIssue,
		workspaceId: activeWorkspace.id,
	});
	return (
		<ComposerSlot
			agentSessionId={agentSessionId}
			chatTabId={activeSession.chatTabId}
			composer={composer}
			seedLinkedIssue={seedLinkedIssue}
			workspace={activeWorkspace}
		/>
	);
}
