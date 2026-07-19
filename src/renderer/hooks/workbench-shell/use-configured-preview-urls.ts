import { useQuery } from '@tanstack/react-query';

import { settingsResolutionQuery } from '@/renderer/api/ensemblr';
import { workbenchRouteApi } from '@/renderer/hooks/workbench-shell/route-layout/use-workbench-layout-model';
import { configuredPreviewUrls } from '@/renderer/lib/workbench/preview-urls';
import type { RepositoryPreviewUrl } from '@/shared/ipc/contracts/repository-settings';

/**
 * Resolves a repository's configured preview URLs (personal SQLite overrides via
 * the settings resolver) for the dock Open control. Empty when none are set, in
 * which case the dock falls back to the auto-detected preview URL.
 * @param projectId - Repository id whose preview URLs to resolve.
 * @returns The configured preview URL entries.
 */
export function useConfiguredPreviewUrls(
	projectId: string,
): RepositoryPreviewUrl[] {
	const loaderData = workbenchRouteApi.useLoaderData();
	const project = loaderData.projects.find(
		(candidate) => candidate.id === projectId,
	);
	const { data: resolution } = useQuery(
		settingsResolutionQuery(
			project
				? { repositoryId: projectId, repositoryPath: project.pathLabel }
				: null,
		),
	);

	return configuredPreviewUrls(resolution);
}
