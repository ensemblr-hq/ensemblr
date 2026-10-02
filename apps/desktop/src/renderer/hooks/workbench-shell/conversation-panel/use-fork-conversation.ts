import { useQueryClient } from '@tanstack/react-query';
import { useNavigate, useRouter } from '@tanstack/react-router';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
	createWorkspace,
	ensemblrQueryKeys,
	openChatTab,
	writeForkSummary,
} from '@/renderer/api/ensemblr-queries';
import { reportCreateWorkspaceWarnings } from '@/renderer/lib/workbench/create-workspace-warnings';
import { useComposerAttachmentDispatcher } from '@/renderer/state/composer';
import type { WorkspaceShellModel } from '@/renderer/types/workbench';
import { pickComposerSurname } from '@/shared/workspace-name-pool';

/** Conversation coordinates a fork operates on. */
interface ForkConversationSource {
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
	const { t } = useTranslation();
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
				throw new Error(
					result.error ??
						t(
							'errors:fork.summary-failed.title',
							'Fork summary could not be written.',
						),
				);
			}
			const { relativePath, title } = result.summary;
			dispatchAttachment(
				{ chatTabId },
				{
					id: `wsfile:${relativePath}`,
					kind: 'workspace-file',
					label: title ?? relativePath.split('/').at(-1) ?? relativePath,
					path: relativePath,
				},
			);
		},
		[branchId, dispatchAttachment, sessionId, t],
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
						title: t('workbench:fork.new-tab-title', 'Forked chat'),
						workspaceId: workspace.id,
					});
					await attachSummary({ chatTabId: opened.tab.id, upToOrdinal });
					await queryClient.invalidateQueries({
						queryKey: ensemblrQueryKeys.chatTabs(workspace.id),
					});
					await navigate({
						params: {
							chatId: opened.tab.id,
							projectId: workspace.projectId,
							workspaceId: workspace.id,
						},
						to: '/projects/$projectId/workspaces/$workspaceId/chats/$chatId',
					});
					toast.success(t('errors:fork.new-tab.title', 'Forked to a new tab.'));
				} catch (error) {
					toast.error(
						error instanceof Error
							? error.message
							: t('errors:fork.failed.title', 'Fork failed.'),
					);
				} finally {
					setIsForking(false);
				}
			})();
		},
		[attachSummary, isForking, navigate, queryClient, t, workspace],
	);

	const forkToNewWorkspace = useCallback(
		(upToOrdinal?: number) => {
			if (isForking) {
				return;
			}
			setIsForking(true);
			void (async () => {
				try {
					const targetBranch =
						workspace.landingSummary?.branchSource.baseBranch;
					const created = await createWorkspace({
						...(targetBranch ? { baseBranch: targetBranch } : {}),
						branchPlan: { forkRef: workspace.branchName, kind: 'create' },
						name: pickComposerSurname(),
						placeholderName: true,
						repositoryId: workspace.projectId,
					});
					if (created.status !== 'success' || !created.workspace) {
						const reason =
							created.diagnostics.find(
								(diagnostic) => diagnostic.severity === 'error',
							)?.message ??
							t(
								'errors:fork.workspace-failed.title',
								'The fork workspace could not be created.',
							);
						throw new Error(reason);
					}
					reportCreateWorkspaceWarnings(created);
					const target = created.workspace;
					const opened = await openChatTab({
						title: t('workbench:fork.new-tab-title', 'Forked chat'),
						workspaceId: target.id,
					});
					await attachSummary({
						chatTabId: opened.tab.id,
						targetWorkspaceCwd: target.path,
						upToOrdinal,
					});
					await queryClient.invalidateQueries({
						queryKey: ensemblrQueryKeys.repositoryWorkspaceNavigation(),
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
					toast.success(
						t(
							'errors:fork.new-workspace.title',
							'Forked to workspace {{name}}.',
							{
								name: target.name,
							},
						),
					);
				} catch (error) {
					toast.error(
						error instanceof Error
							? error.message
							: t('errors:fork.failed.title', 'Fork failed.'),
					);
				} finally {
					setIsForking(false);
				}
			})();
		},
		[attachSummary, isForking, navigate, queryClient, router, t, workspace],
	);

	// Held stable so the timeline's memoized turns are not invalidated by a fresh
	// object on every render of a streaming transcript.
	return useMemo(
		() => ({ forkToNewTab, forkToNewWorkspace, isForking }),
		[forkToNewTab, forkToNewWorkspace, isForking],
	);
}
