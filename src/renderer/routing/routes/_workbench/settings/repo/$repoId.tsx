import { createFileRoute, Outlet } from '@tanstack/react-router';
import { useSetAtom } from 'jotai';
import { useEffect } from 'react';

import { workbenchRouteApi } from '@/renderer/components/workbench-shell/route-layout/use-workbench-layout-model';
import { settingsActiveRepoIdAtom } from '@/renderer/state/preferences';

export const Route = createFileRoute('/_workbench/settings/repo/$repoId')({
	component: RepoSettingsLayout,
});

/** Validates the repoId path param against the project list and remembers it for next visit. */
function RepoSettingsLayout() {
	const { repoId } = Route.useParams();
	const loaderData = workbenchRouteApi.useLoaderData();
	const project = loaderData.projects.find(
		(candidate) => candidate.id === repoId,
	);
	const setLastRepoId = useSetAtom(settingsActiveRepoIdAtom);

	useEffect(() => {
		if (project) {
			setLastRepoId(project.id);
		}
	}, [project, setLastRepoId]);

	if (!project) {
		return (
			<div className='mx-auto w-full max-w-3xl px-8 py-10 text-muted-foreground text-sm'>
				Repository <span className='font-mono text-foreground'>{repoId}</span>{' '}
				not found.
			</div>
		);
	}

	return <Outlet />;
}
