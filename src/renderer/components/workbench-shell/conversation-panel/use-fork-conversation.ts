import { useQueryClient } from '@tanstack/react-query';
import { useNavigate, useRouter } from '@tanstack/react-router';
import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import {
	createWorkspace,
	ensembleQueryKeys,
	openChatTab,
	writeForkSummary,
} from '@/renderer/api/ensemble-queries';
import { pickComposerSurname } from '@/renderer/lib/workbench/workspace-name-pool';
import { useComposerAttachmentDispatcher } from '@/renderer/state/composer-attachments';
import type { WorkspaceShellModel } from '@/renderer/types/workbench';

/** Conversation coordinates a fork operates on. */
export interface ForkConversationSource {
	branchId: string;
	sessionId: string;
	workspace: WorkspaceShellModel;
}

/**
 * Forks the active conversation at a turn boundary. Both flows write a
 * to-the-point handoff summary of the conversation up to `upToOrdinal` (via
 * the fork-summary IPC) and attach it as a composer file chip in the
 * destination chat:
 *   - fork to new tab: new chat tab in the same workspace;
 *   - fork to new workspace: new workspace branched from the current
 *     workspace branch, with the summary written into its `.context/`.
 */
export function useForkConversation({
	branchId,
	sessionId,
	workspace,
}: ForkConversationSource): {
	forkToNewTab: (upToOrdinal?: number) => void;
	forkToNewWorkspace: (upToOrdinal?: number) => void;
	isForking: boolean;
} {
	const navigate = useNavigate();
	const router = useRouter();
	const queryClient = useQueryClient();
	const dispatchAttachment = useComposerAttachmentDispatcher();
	const [isForking, setIsForking] = useState(false);

	/** Writes the summary for `chatTabId` and queues it as a composer chip. */
	const attachSummary = useCallback(
		async ({
			chatTabId,
			targetWorkspaceCwd,
			upToOrdinal,
		}: {
			chatTabId: string;
			targetWorkspaceCwd?: string;
			upToOrdinal?: number;
		}) => {
			const result = await writeForkSummary({
				branchId,
				fileBaseName: chatTabId,
				sessionId,
				targetWorkspaceCwd,
				upToOrdinal,
			});
			if (!result.summary) {
				throw new Error(result.error ?? 'Fork summary could not be written.');
			}
			const { relativePath, title } = result.summary;
			dispatchAttachment(chatTabId, {
				id: `wsfile:${relativePath}`,
				kind: 'file',
				name: title ?? relativePath.split('/').at(-1) ?? relativePath,
				path: relativePath,
			});
		},
		[branchId, dispatchAttachment, sessionId],
	);

	const forkToNewTab = useCallback(
		(upToOrdinal?: number) => {
			if (isForking) {
				return;
			}
			setIsForking(true);
			void (async () => {
				try {
					const opened = await openChatTab({
						title: 'Forked chat',
						workspaceId: workspace.id,
					});
					await attachSummary({ chatTabId: opened.tab.id, upToOrdinal });
					await queryClient.invalidateQueries({
						queryKey: ensembleQueryKeys.chatTabs(workspace.id),
					});
					await navigate({
						params: {
							chatId: opened.tab.id,
							projectId: workspace.projectId,
							workspaceId: workspace.id,
						},
						to: '/projects/$projectId/workspaces/$workspaceId/chats/$chatId',
					});
					toast.success('Forked to a new tab.');
				} catch (error) {
					toast.error(error instanceof Error ? error.message : 'Fork failed.');
				} finally {
					setIsForking(false);
				}
			})();
		},
		[attachSummary, isForking, navigate, queryClient, workspace],
	);

	const forkToNewWorkspace = useCallback(
		(upToOrdinal?: number) => {
			if (isForking) {
				return;
			}
			setIsForking(true);
			void (async () => {
				try {
					const created = await createWorkspace({
						baseBranch: workspace.branchName,
						name: pickComposerSurname(),
						repositoryId: workspace.projectId,
					});
					if (created.status !== 'success' || !created.workspace) {
						const reason =
							created.diagnostics.find(
								(diagnostic) => diagnostic.severity === 'error',
							)?.message ?? 'The fork workspace could not be created.';
						throw new Error(reason);
					}
					const target = created.workspace;
					const opened = await openChatTab({
						title: 'Forked chat',
						workspaceId: target.id,
					});
					await attachSummary({
						chatTabId: opened.tab.id,
						targetWorkspaceCwd: target.path,
						upToOrdinal,
					});
					await queryClient.invalidateQueries({
						queryKey: ensembleQueryKeys.repositoryWorkspaceNavigation(),
					});
					await router.invalidate();
					await navigate({
						params: {
							chatId: opened.tab.id,
							projectId: workspace.projectId,
							workspaceId: target.id,
						},
						to: '/projects/$projectId/workspaces/$workspaceId/chats/$chatId',
					});
					toast.success(`Forked to workspace ${target.name}.`);
				} catch (error) {
					toast.error(error instanceof Error ? error.message : 'Fork failed.');
				} finally {
					setIsForking(false);
				}
			})();
		},
		[attachSummary, isForking, navigate, queryClient, router, workspace],
	);

	return { forkToNewTab, forkToNewWorkspace, isForking };
}
