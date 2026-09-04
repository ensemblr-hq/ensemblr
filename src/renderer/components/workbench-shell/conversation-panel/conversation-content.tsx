import { useAtomValue } from 'jotai';
import { useMemo } from 'react';
import { MarkdownDocumentScopeProvider } from '@/renderer/components/markdown';
import { XtermTerminal } from '@/renderer/components/workbench-shell/dock-panel/xterm-terminal';
import { useConversationOpeners } from '@/renderer/hooks/workbench-shell/conversation-panel/use-conversation-openers';
import { useLinkedIssueComposerSeed } from '@/renderer/hooks/workspace/use-linked-issue-composer-seed';
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
import { ArchitectureDiagramPanel } from './architecture-diagram';
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
	onOpenArchitectureDiagram,
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
	onOpenArchitectureDiagram: () => Promise<{ chatTabId: string } | null>;
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
	const workspaceCwd = activeWorkspace.pathLabel ?? null;
	// Chat sits at the workspace root: an agent writes the paths it reports
	// relative to the repository, not to any document of its own.
	const markdownDocumentScope = useMemo(
		() => (workspaceCwd ? { baseDirectory: '', workspaceCwd } : null),
		[workspaceCwd],
	);

	return (
		<section className='relative flex min-h-0 flex-1 flex-col overflow-hidden'>
			<SessionTabs
				activeSession={activeSession}
				closedSessions={closedSessions}
				onLaunchHarness={onLaunchHarness}
				onOpenArchitectureDiagram={onOpenArchitectureDiagram}
				onSessionTabClose={onSessionTabClose}
				onSessionTabChange={onSessionTabChange}
				onSessionTabOpen={onSessionTabOpen}
				onSessionTabPin={onSessionTabPin}
				onSessionTabRestore={onSessionTabRestore}
				onSessionTabsReorder={onSessionTabsReorder}
				sessions={sessionTabs}
				unreadKeys={unreadKeys}
			/>
			<WorkspacePathResolverProvider value={resolveWorkspacePath}>
				<FilePreviewOpenerProvider value={openFilePreview}>
					<MarkdownDocumentScopeProvider value={markdownDocumentScope}>
						{isChatTab ? (
							<ChatTabBody
								activeSession={activeSession}
								activeWorkspace={activeWorkspace}
								composer={composer}
								openTurnDiff={openTurnDiff}
							/>
						) : (
							<ActiveAuxiliaryPanel
								activeSession={activeSession}
								activeWorkspace={activeWorkspace}
								onDirectoryReveal={onDirectoryReveal}
								onSessionTabChange={onSessionTabChange}
							/>
						)}
					</MarkdownDocumentScopeProvider>
				</FilePreviewOpenerProvider>
			</WorkspacePathResolverProvider>
			{developerMode ? <PiRawFramePanel sessionId={debugSessionId} /> : null}
		</section>
	);
}

/**
 * Renders a chat tab's timeline and composer under the turn-diff opener only
 * chat rows reach for; path resolution and the preview opener come from the
 * conversation surface, which shares them with the file tabs. A tab that gets no
 * composer is a spawned sub-agent's — the only case `showsComposer` refuses —
 * so its runtime readout takes the slot the composer would have occupied.
 */
function ChatTabBody({
	activeSession,
	activeWorkspace,
	composer,
	openTurnDiff,
}: {
	activeSession: SessionTabModel;
	activeWorkspace: WorkspaceShellModel;
	composer: ComposerShellState;
	openTurnDiff: (input: { label: string; turnId: string }) => void;
}) {
	return (
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
	);
}

/**
 * Renders the panel for a non-chat session tab (diagram, terminal, diff,
 * document, or file). Split out of `WorkspaceConversationContent` so the
 * per-kind branching lives in one focused component instead of inflating the
 * parent's complexity.
 */
function ActiveAuxiliaryPanel({
	activeSession,
	activeWorkspace,
	onDirectoryReveal,
	onSessionTabChange,
}: {
	activeSession: SessionTabModel;
	activeWorkspace: WorkspaceShellModel;
	onDirectoryReveal: (directoryPath: string) => void;
	onSessionTabChange: (sessionId: string) => void;
}) {
	if (activeSession.kind === 'diagram') {
		return (
			<ArchitectureDiagramPanel
				onDirectoryReveal={onDirectoryReveal}
				workspaceId={activeWorkspace.id}
			/>
		);
	}
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
