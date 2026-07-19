import { useQuery } from '@tanstack/react-query';

import { settingsResolutionQuery } from '@/renderer/api/ensemblr';
import { workbenchRouteApi } from '@/renderer/hooks/workbench-shell/route-layout/use-workbench-layout-model';
import type { RepoSettingsKey } from '@/renderer/state/preferences';
import type { ResolvedSettingSnapshot } from '@/shared/ipc/contracts/settings-resolution';

/**
 * Bundle for a per-repo settings page: the resolved settings snapshot from the
 * IPC resolver plus a typed `resolved(key)` lookup that constrains keys to
 * {@link RepoSettingsKey} so typos fail the type-check instead of silently
 * returning `undefined`. Writes go through {@link useRepoSettingsWriter}.
 *
 * `project` is `undefined` if the route param doesn't match a known repo —
 * the parent `$repoId` layout already handles that case, so callers can
 * safely treat it as defined inside the route component.
 */
export function useRepoSettings(repoId: string) {
	const loaderData = workbenchRouteApi.useLoaderData();
	const project = loaderData.projects.find((p) => p.id === repoId);

	const { data: resolutionData } = useQuery(
		settingsResolutionQuery(
			project
				? { repositoryId: repoId, repositoryPath: project.pathLabel }
				: null,
		),
	);

	const resolved = (
		key: RepoSettingsKey,
	): ResolvedSettingSnapshot | undefined =>
		resolutionData?.repository?.settings.find((s) => s.key === key);

	return { resolved, project };
}
