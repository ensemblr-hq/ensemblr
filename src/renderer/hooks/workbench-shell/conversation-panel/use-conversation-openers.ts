import { useCallback, useMemo } from 'react';

import {
	createWorkspacePathResolver,
	toWorkspaceLookupPath,
} from '@/renderer/lib/agent-timeline';
import type { WorkspaceShellModel } from '@/renderer/types/workbench';

/**
 * Builds the workspace path resolver plus the preview openers a chat tab hands
 * down through context: one that reveals a directory or opens a file preview
 * tab, and one that opens the diff tab for a checkpointed turn. Both focus the
 * tab they opened.
 * @param activeWorkspace - Workspace whose file index resolves chip paths
 * @param onDirectoryReveal - Reveals a directory in the review tree
 * @param onFilePreviewOpen - Opens or re-focuses the preview tab for a file
 * @param onSessionTabChange - Focuses a chat tab by id
 * @param onTurnDiffOpen - Opens or re-focuses the diff tab for a turn
 * @returns The path resolver and the two opener callbacks
 */
export function useConversationOpeners({
	activeWorkspace,
	onDirectoryReveal,
	onFilePreviewOpen,
	onSessionTabChange,
	onTurnDiffOpen,
}: {
	activeWorkspace: WorkspaceShellModel;
	onDirectoryReveal: (directoryPath: string) => void;
	onFilePreviewOpen: (input: {
		filePath: string;
	}) => Promise<{ chatTabId: string } | null>;
	onSessionTabChange: (sessionId: string) => void;
	onTurnDiffOpen: (input: {
		label: string;
		turnId: string;
	}) => Promise<{ chatTabId: string } | null>;
}): {
	openFilePreview: (filePath: string) => void;
	openTurnDiff: (input: { label: string; turnId: string }) => void;
	resolveWorkspacePath: ReturnType<typeof createWorkspacePathResolver>;
} {
	const workspaceCwd = activeWorkspace.pathLabel ?? null;
	const resolveWorkspacePath = useMemo(
		() =>
			createWorkspacePathResolver(activeWorkspace.workspaceFiles, workspaceCwd),
		[activeWorkspace.workspaceFiles, workspaceCwd],
	);

	const openFilePreview = useCallback(
		(filePath: string) => {
			const resolved = resolveWorkspacePath(filePath);
			const previewPath =
				resolved?.path ?? toWorkspaceLookupPath(filePath, workspaceCwd);
			if (resolved?.kind === 'directory') {
				onDirectoryReveal(previewPath);
				return;
			}
			void onFilePreviewOpen({ filePath: previewPath }).then((result) => {
				if (result) {
					onSessionTabChange(result.chatTabId);
				}
			});
		},
		[
			onDirectoryReveal,
			onFilePreviewOpen,
			onSessionTabChange,
			resolveWorkspacePath,
			workspaceCwd,
		],
	);

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

	return { openFilePreview, openTurnDiff, resolveWorkspacePath };
}
