import { useCallback } from 'react';

import { toWorkspaceRelativePath } from '@/renderer/lib/pi';
import { formatLinkedIssueComposerSeed } from '@/renderer/lib/workbench';
import { usePiRawFrameCapture } from '@/renderer/state/pi';
import type {
	ComposerShellState,
	SessionTabModel,
	WorkspaceShellModel,
} from '@/renderer/types/workbench';

import { CommentPreviewPanel } from './comment-preview-panel';
import { ComposerPanel } from './composer-panel';
import {
	FilePreviewOpenerProvider,
	TurnDiffOpenerProvider,
} from './file-preview-context';
import { FilePreviewPanel } from './file-preview-panel';
import { PiRawFramePanel } from './pi-raw-frame-panel';
import { SessionTabs } from './session-tabs';
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
	onFilePreviewOpen,
	onSessionTabChange,
	onSessionTabClose,
	onSessionTabOpen,
	onSessionTabRestore,
	onTurnDiffOpen,
	sessionTabs,
}: {
	activeSession: SessionTabModel;
	activeWorkspace: WorkspaceShellModel;
	closedSessions: SessionTabModel[];
	composer: ComposerShellState;
	onFilePreviewOpen: (input: {
		filePath: string;
	}) => Promise<{ chatTabId: string } | null>;
	onTurnDiffOpen: (input: {
		label: string;
		turnId: string;
	}) => Promise<{ chatTabId: string } | null>;
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
	const isChatTab = (activeSession.kind ?? 'chat') === 'chat';

	/** Opens or re-focuses the preview tab for a chip's file and navigates to it. */
	const workspaceCwd = activeWorkspace.pathLabel ?? null;
	const openFilePreview = useCallback(
		(filePath: string) => {
			const relativePath = toWorkspaceRelativePath(filePath, workspaceCwd);
			void onFilePreviewOpen({ filePath: relativePath }).then((result) => {
				if (result) {
					onSessionTabChange(result.chatTabId);
				}
			});
		},
		[onFilePreviewOpen, onSessionTabChange, workspaceCwd],
	);

	/** Opens or re-focuses the diff tab for a checkpointed turn. */
	const openTurnDiff = useCallback(
		({ label, turnId }: { label: string; turnId: string }) => {
			void onTurnDiffOpen({ label, turnId }).then((result) => {
				if (result) {
					onSessionTabChange(result.chatTabId);
				}
			});
		},
		[onTurnDiffOpen, onSessionTabChange],
	);

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
			{isChatTab ? (
				<FilePreviewOpenerProvider value={openFilePreview}>
					<TurnDiffOpenerProvider value={openTurnDiff}>
						<div className='flex min-h-0 flex-1 flex-col overflow-hidden'>
							<WorkspaceTimeline
								activeSession={activeSession}
								composer={composer}
								workspace={activeWorkspace}
							/>
						</div>
						<ComposerPanel
							chatTabId={activeSession.chatTabId}
							composer={composer}
							seedText={getLinkedIssueComposerSeed(
								activeWorkspace,
								activeSession,
							)}
						/>
					</TurnDiffOpenerProvider>
				</FilePreviewOpenerProvider>
			) : activeSession.kind === 'diff' ? (
				activeSession.filePath ? (
					<WorkspaceFileDiffPanel
						filePath={activeSession.filePath}
						scope={activeSession.diffScope ?? undefined}
						workspaceCwd={activeWorkspace.pathLabel ?? null}
						workspaceId={activeWorkspace.id}
					/>
				) : (
					<TurnDiffPanel turnId={activeSession.turnId ?? null} />
				)
			) : activeSession.kind === 'document' && activeSession.commentPreview ? (
				<CommentPreviewPanel comment={activeSession.commentPreview} />
			) : (
				<FilePreviewPanel
					filePath={activeSession.filePath ?? null}
					workspaceCwd={activeWorkspace.pathLabel ?? null}
				/>
			)}
			<PiRawFramePanel sessionId={debugSessionId} />
		</section>
	);
}

/**
 * Composer seed for issue-created workspaces: the issue contents (heading, body,
 * link) are offered as the first-prompt draft (no Pi session yet); the user
 * edits and presses send — nothing is auto-submitted.
 */
function getLinkedIssueComposerSeed(
	workspace: WorkspaceShellModel,
	session: SessionTabModel,
): string | undefined {
	const linkedIssue = workspace.landingSummary?.linkedIssue;

	if (!linkedIssue || session.piSessionId) {
		return undefined;
	}

	return formatLinkedIssueComposerSeed({
		...(linkedIssue.description !== undefined
			? { description: linkedIssue.description }
			: {}),
		reference: linkedIssue.reference,
		title: linkedIssue.title,
		...(linkedIssue.url !== undefined ? { url: linkedIssue.url } : {}),
	});
}
