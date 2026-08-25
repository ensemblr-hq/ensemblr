import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSetAtom } from 'jotai';
import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import {
	allChatTabsQuery,
	conciergeArtifactsQuery,
	ensemblrQueryKeys,
	restoreChatTab,
} from '@/renderer/api/ensemblr';
import type { ConciergeReferenceAccess } from '@/renderer/components/concierge/concierge-reference-context';
import { useWorkbenchLayoutRouteModelOptional } from '@/renderer/components/workbench-shell/shell-contexts';
import {
	buildConciergeReferences,
	findConciergeReference,
} from '@/renderer/lib/concierge';
import {
	conciergePreviewAtom,
	restoreConciergePanelAtom,
} from '@/renderer/state/concierge';
import {
	CONCIERGE_ARTIFACTS_DIRECTORY,
	type ConciergeReference,
} from '@/shared/concierge-references';

/**
 * Makes the projects, workspaces, chats, and artifacts the Concierge names
 * openable: a click focuses the workspace, or the chat tab inside it, wherever in
 * the app it lives — and an artifact opens in the panel's own viewer, since the
 * Concierge home belongs to no workspace and has no tab strip to land in.
 *
 * The catalogue is the same one the `@` menu ranks against, so a chip and a menu
 * row can never disagree about what the app holds — a workspace archived since
 * the answer was written drops out of both at once, and its chip goes inert
 * rather than navigating into a route that no longer resolves. A project has no
 * surface of its own to focus, so it resolves (the chip still names it) and
 * opens nothing.
 *
 * A maximized Concierge is put back in its docked card on the way out, or the
 * panel would still be covering the workspace it just focused.
 * @param enabled - False while the Concierge is shut, which keeps the app-wide
 *   tab listing unfetched for a user who never opens it.
 * @returns The resolver and opener the panel provides to its chips.
 */
export function useConciergeReferenceOpen(
	enabled: boolean,
): ConciergeReferenceAccess {
	const { t } = useTranslation();
	const queryClient = useQueryClient();
	const layoutModel = useWorkbenchLayoutRouteModelOptional();
	const restorePanel = useSetAtom(restoreConciergePanelAtom);
	const setPreview = useSetAtom(conciergePreviewAtom);
	const projects = layoutModel?.displayProjects;
	const navigateToWorkspace = layoutModel?.navigateToWorkspace;
	const { data: chatTabs } = useQuery({ ...allChatTabsQuery, enabled });
	const { data: artifacts } = useQuery({ ...conciergeArtifactsQuery, enabled });

	const references = useMemo(
		() =>
			buildConciergeReferences({
				artifacts: artifacts?.artifacts ?? [],
				chatTabs: chatTabs ?? { closed: [], open: [] },
				projects: projects ?? [],
			}),
		[artifacts, chatTabs, projects],
	);

	const openChat = useCallback(
		async (reference: Extract<ConciergeReference, { kind: 'chat' }>) => {
			const projectId = workspaceProjectId(references, reference.workspaceId);
			if (!projectId) {
				return;
			}
			if (reference.state === 'closed') {
				await restoreChatTab({ chatTabId: reference.chatTabId });
				await Promise.all([
					queryClient.invalidateQueries({
						queryKey: ensemblrQueryKeys.chatTabs(reference.workspaceId),
					}),
					queryClient.invalidateQueries({
						queryKey: ensemblrQueryKeys.allChatTabs(),
					}),
				]);
			}
			restorePanel();
			navigateToWorkspace?.(
				projectId,
				reference.workspaceId,
				reference.chatTabId,
			);
		},
		[navigateToWorkspace, queryClient, references, restorePanel],
	);

	const openReference = useCallback(
		(reference: ConciergeReference) => {
			if (reference.kind === 'project') {
				return;
			}
			if (reference.kind === 'artifact') {
				setPreview({
					path: `${CONCIERGE_ARTIFACTS_DIRECTORY}/${reference.path}`,
					title: reference.label,
				});
				return;
			}
			if (reference.kind === 'workspace') {
				restorePanel();
				navigateToWorkspace?.(reference.projectId, reference.workspaceId);
				return;
			}
			openChat(reference).catch((cause: unknown) => {
				toast.error(
					t('errors:chat-tab.restore-failed.title', 'Could not reopen chat'),
					{ description: cause instanceof Error ? cause.message : undefined },
				);
			});
		},
		[navigateToWorkspace, openChat, restorePanel, setPreview, t],
	);

	return useMemo(
		() => ({
			openReference,
			// An artifact resolves without the shell: it opens in the panel's own
			// viewer, so unlike the three surfaces below it there is no route to
			// navigate and nothing to be missing.
			resolveReference: (kind, id) =>
				kind === 'artifact' || navigateToWorkspace
					? findConciergeReference(references, kind, id)
					: null,
		}),
		[navigateToWorkspace, openReference, references],
	);
}

/**
 * The project a workspace belongs to, read back off the catalogue so a chat
 * reference does not have to carry a project id its block never needed.
 * @param references - The catalogue.
 * @param workspaceId - Workspace holding the chat.
 * @returns The project id, or null when the workspace is no longer shown.
 */
function workspaceProjectId(
	references: readonly ConciergeReference[],
	workspaceId: string,
): string | null {
	for (const reference of references) {
		if (
			reference.kind === 'workspace' &&
			reference.workspaceId === workspaceId
		) {
			return reference.projectId;
		}
	}
	return null;
}
