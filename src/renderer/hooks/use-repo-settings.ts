import { useQuery } from '@tanstack/react-query';
import { useAtomValue } from 'jotai';

import { settingsResolutionQuery } from '@/renderer/api/ensemblr';
import { workbenchRouteApi } from '@/renderer/hooks/workbench-shell/route-layout/use-workbench-layout-model';
import type { RepoSettingsKey } from '@/renderer/state/preferences';
import { lastWorkspaceSelectionAtom } from '@/renderer/state/workspace';
import type { ProjectShellModel } from '@/renderer/types/workbench';
import type { ResolvedSettingSnapshot } from '@/shared/ipc/contracts/settings-resolution';

/**
 * Which checkout a settings screen resolves against. `workspace` mirrors what
 * the dock actually runs; `root` mirrors the repository's canonical committed
 * config, which is the copy the Scripts screen edits.
 */
export type RepoSettingsOrigin = 'root' | 'workspace';

/**
 * Picks the path a repository's committed `.ensemblr/settings.toml` is read
 * from: the workspace the user last had open, else any workspace of the repo,
 * else the repository root. The script lifecycle service resolves against the
 * workspace worktree, so reading the repository root here would show settings
 * that differ from what the dock actually runs — a root sitting on the default
 * branch has none of the config a workspace branch adds.
 * @param project - The repository being configured.
 * @param selection - The last-selected (project, workspace) pair.
 * @returns The worktree path to resolve settings from.
 */
function resolveSettingsPath(
	project: ProjectShellModel,
	selection: { projectId: string; workspaceId: string } | null,
): string {
	const workspace =
		selection?.projectId === project.id
			? project.workspaces.find(
					(candidate) => candidate.id === selection.workspaceId,
				)
			: undefined;

	return (
		workspace?.pathLabel ??
		project.workspaces[0]?.pathLabel ??
		project.pathLabel
	);
}

/**
 * Bundle for a per-repo settings page: the resolved settings snapshot from the
 * IPC resolver plus a typed `resolved(key)` lookup that constrains keys to
 * {@link RepoSettingsKey} so typos fail the type-check instead of silently
 * returning `undefined`. Writes go through {@link useRepoSettingsWriter}.
 *
 * `project` is `undefined` if the route param doesn't match a known repo —
 * the parent `$repoId` layout already handles that case, so callers can
 * safely treat it as defined inside the route component.
 *
 * `origin` selects the checkout to resolve against: the last-open workspace by
 * default, or the repository root for screens that edit the canonical committed
 * config rather than a branch's copy of it.
 */
export function useRepoSettings(
	repoId: string,
	origin: RepoSettingsOrigin = 'workspace',
) {
	const loaderData = workbenchRouteApi.useLoaderData();
	const project = loaderData.projects.find((p) => p.id === repoId);
	const lastSelection = useAtomValue(lastWorkspaceSelectionAtom);
	const settingsPath = project
		? origin === 'root'
			? project.pathLabel
			: resolveSettingsPath(project, lastSelection)
		: null;

	const { data: resolutionData } = useQuery(
		settingsResolutionQuery(
			project && settingsPath
				? { repositoryId: repoId, repositoryPath: settingsPath }
				: null,
		),
	);

	const resolved = (
		key: RepoSettingsKey,
	): ResolvedSettingSnapshot | undefined =>
		resolutionData?.repository?.settings.find((s) => s.key === key);

	return { resolved, project, settingsPath };
}
