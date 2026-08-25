import { useQueryClient } from '@tanstack/react-query';
import { useSetAtom } from 'jotai';
import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import {
	ensemblrQueryKeys,
	openChatTab,
	writeOpenedChatTabToCache,
} from '@/renderer/api/ensemblr';
import { useWorkbenchLayoutRouteModelOptional } from '@/renderer/components/workbench-shell/shell-contexts';
import {
	type ConciergeFileTarget,
	resolveConciergeFileTarget,
} from '@/renderer/lib/concierge';
import {
	conciergePreviewAtom,
	restoreConciergePanelAtom,
} from '@/renderer/state/concierge';
import { basenameOf } from '@/renderer/state/workspace';
import type {
	ProjectShellModel,
	WorkspacePathResolver,
} from '@/renderer/types/workbench';

/**
 * What the Concierge transcript hands its attachment chips: whether a path can
 * be opened at all, and what to do when one is clicked. Both are null outside
 * the workbench shell, where there are no projects to place a path against —
 * chips then render in their inert form rather than as dead buttons.
 */
interface ConciergeFilePreview {
	openFilePreview: ((filePath: string) => void) | null;
	resolveFilePath: WorkspacePathResolver | null;
}

/**
 * Whether a path the Concierge wrote points inside its own home, which is where
 * `MEMORY.md`, `memory/`, and `artifacts/` live.
 * @param home - The Concierge home, or null before a session is open.
 * @param filePath - Path exactly as the Concierge wrote it.
 * @returns The path relative to the home, or null when it points elsewhere.
 */
function homeRelativePath(
	home: string | null,
	filePath: string,
): string | null {
	if (!home) {
		return null;
	}
	const trimmed = filePath.trim();
	const prefix = home.endsWith('/') ? home : `${home}/`;
	if (!trimmed.startsWith(prefix)) {
		return null;
	}
	const relative = trimmed.slice(prefix.length);
	return relative && !relative.includes('..') ? relative : null;
}

/**
 * Makes the file references in the Concierge's answers openable: a click focuses
 * the workspace the file belongs to and opens its preview tab there.
 *
 * The Concierge sits above every project, so this resolves against the shell's
 * whole project list rather than one workspace's file tree, and only a path that
 * lands in a known worktree or repository earns a chip. Everything else stays
 * inline code, because a chip that cannot say which project a bare `README.md`
 * belongs to would open the wrong one.
 *
 * A path inside the Concierge's own home is the exception, and the reason this
 * hook takes one: `memory/`, `artifacts/`, and `MEMORY.md` belong to no project
 * at all, so before this they were the one kind of file the Concierge could write
 * and never show. Those open in the panel's own viewer instead of a workspace
 * tab, which also works from the dashboard where no workspace is focused.
 *
 * A maximized Concierge is put back in its docked card on the way out, or the
 * panel would still be covering the preview it just opened.
 * @param home - The open session's Concierge home, or null before one is open.
 * @returns The path resolver and the opener the timeline provides to its chips.
 */
export function useConciergeFilePreview(
	home: string | null,
): ConciergeFilePreview {
	const { t } = useTranslation();
	const queryClient = useQueryClient();
	const layoutModel = useWorkbenchLayoutRouteModelOptional();
	const restorePanel = useSetAtom(restoreConciergePanelAtom);
	const setPreview = useSetAtom(conciergePreviewAtom);
	const projects = layoutModel?.displayProjects ?? null;
	const navigateToWorkspace = layoutModel?.navigateToWorkspace ?? null;

	const openTarget = useCallback(
		async (target: ConciergeFileTarget) => {
			try {
				const { tab } = await openChatTab({
					kind: 'file',
					metadata: { filePath: target.filePath },
					preview: true,
					title: basenameOf(target.filePath),
					workspaceId: target.workspaceId,
				});
				writeOpenedChatTabToCache({
					queryClient,
					tab,
					workspaceId: target.workspaceId,
				});
				void queryClient.invalidateQueries({
					queryKey: ensemblrQueryKeys.chatTabs(target.workspaceId),
				});
				restorePanel();
				navigateToWorkspace?.(target.projectId, target.workspaceId, tab.id);
			} catch (cause) {
				toast.error(
					t('errors:chat-tab.open-failed.title', 'Could not open tab'),
					{
						description: cause instanceof Error ? cause.message : undefined,
					},
				);
			}
		},
		[navigateToWorkspace, queryClient, restorePanel, t],
	);

	return useMemo(() => {
		const openHomeFile = (filePath: string): boolean => {
			const relative = homeRelativePath(home, filePath);
			if (!relative) {
				return false;
			}
			setPreview({ path: relative, title: basenameOf(relative) });
			return true;
		};
		const canOpen = Boolean(projects) || home !== null;
		return {
			openFilePreview: canOpen
				? (filePath: string) => {
						if (openHomeFile(filePath)) {
							return;
						}
						const target = projects
							? resolveConciergeFileTarget(projects, filePath)
							: null;
						if (target) {
							void openTarget(target);
						}
					}
				: null,
			resolveFilePath: canOpen ? toPathResolver(projects ?? [], home) : null,
		};
	}, [home, openTarget, projects, setPreview]);
}

/**
 * Adapts the target lookup to the resolver the shared markdown renderer reads,
 * which asks only whether a path is openable and under which name to show it.
 * The path is echoed back as written so the chip's tooltip names the file the
 * Concierge named, and the opener re-places it against the same projects.
 * @param projects - Every project the shell knows
 * @param home - The Concierge home, whose own files are openable without a project
 * @returns A resolver answering for paths this hook can actually open
 */
function toPathResolver(
	projects: readonly ProjectShellModel[],
	home: string | null,
): WorkspacePathResolver {
	return (filePath: string) =>
		(homeRelativePath(home, filePath) ??
		resolveConciergeFileTarget(projects, filePath))
			? { kind: 'file', path: filePath, scope: 'external' }
			: null;
}
