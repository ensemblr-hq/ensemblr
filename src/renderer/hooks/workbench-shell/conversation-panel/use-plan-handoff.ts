import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useStore } from 'jotai';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
	ensemblrQueryKeys,
	openChatTab,
} from '@/renderer/api/ensemblr-queries';
import {
	composerValueAtomFamily,
	useComposerAttachmentDispatcher,
	useRequestComposerFocus,
} from '@/renderer/state/composer';
import type { WorkspaceShellModel } from '@/renderer/types/workbench';

/** The approved plan being handed to a fresh conversation. */
interface PlanHandoffInput {
	/** Workspace-relative path of the saved plan markdown. */
	planPath: string | null;
	title: string;
}

/**
 * Hands a finished plan to a new chat tab in the same workspace: opens the tab,
 * seeds its draft, attaches the plan file as a composer chip, and focuses it.
 * Nothing is submitted — the user reads the plan in place and sends when ready.
 *
 * The draft is written straight into the composer's draft atom rather than
 * passed as `seedText`, which a render-derived prop would skip once the draft is
 * non-empty, and the plan rides as a file chip rather than inlined text so the
 * new agent receives it as an attachment.
 */
export function usePlanHandoff(workspace: WorkspaceShellModel): {
	handOff: (input: PlanHandoffInput) => Promise<string | null>;
	isHandingOff: boolean;
} {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const { t } = useTranslation();
	const store = useStore();
	const dispatchAttachment = useComposerAttachmentDispatcher();
	const requestComposerFocus = useRequestComposerFocus();
	const [isHandingOff, setIsHandingOff] = useState(false);

	const handOff = useCallback(
		async ({ planPath, title }: PlanHandoffInput): Promise<string | null> => {
			if (isHandingOff) {
				return null;
			}
			setIsHandingOff(true);
			try {
				const opened = await openChatTab({
					title: `Implement: ${title}`,
					workspaceId: workspace.id,
				});
				const chatTabId = opened.tab.id;
				store.set(
					composerValueAtomFamily(chatTabId),
					'Implement the attached plan.',
				);
				if (planPath) {
					dispatchAttachment(chatTabId, {
						id: `wsfile:${planPath}`,
						kind: 'workspace-file',
						label: planPath.split('/').at(-1) ?? planPath,
						path: planPath,
					});
				}
				await queryClient.invalidateQueries({
					queryKey: ensemblrQueryKeys.chatTabs(workspace.id),
				});
				await navigate({
					params: {
						chatId: chatTabId,
						projectId: workspace.projectId,
						workspaceId: workspace.id,
					},
					to: '/projects/$projectId/workspaces/$workspaceId/chats/$chatId',
				});
				requestComposerFocus(chatTabId);
				return chatTabId;
			} catch (error) {
				toast.error(
					error instanceof Error
						? error.message
						: t('errors:plan-handoff.failed.title', 'Plan handoff failed.'),
				);
				return null;
			} finally {
				setIsHandingOff(false);
			}
		},
		[
			dispatchAttachment,
			isHandingOff,
			navigate,
			queryClient,
			requestComposerFocus,
			store,
			t,
			workspace,
		],
	);

	return { handOff, isHandingOff };
}
