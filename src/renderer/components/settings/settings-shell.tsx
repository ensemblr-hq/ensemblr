import { Outlet, useRouterState } from '@tanstack/react-router';
import { useAtomValue } from 'jotai';
import { useMemo } from 'react';

import { SettingsHeader } from '@/renderer/components/settings/settings-header';
import { SettingsSidebar } from '@/renderer/components/settings/settings-sidebar';
import { ScrollArea } from '@/renderer/components/ui/scroll-area';
import { useCloseSettings } from '@/renderer/hooks/use-close-settings';
import { workbenchRouteApi } from '@/renderer/hooks/workbench-shell/route-layout/use-workbench-layout-model';
import { useRegisterCloseAction } from '@/renderer/state/close-action';
import { settingsActiveRepoIdAtom } from '@/renderer/state/settings-ui';
import type { SettingsScope } from '@/renderer/types/settings';

/** Derive the active scope from the current pathname. */
function getScopeFromPath(pathname: string): SettingsScope {
	return pathname.startsWith('/settings/repo') ? 'repo' : 'user';
}

/** Two-column layout shell used by every settings sub-route. */
export function SettingsShell() {
	const pathname = useRouterState({ select: (s) => s.location.pathname });
	const scope = getScopeFromPath(pathname);
	// ⌘/Ctrl+W closes settings — return to the screen Settings was opened from
	// (root fallback), matching the ← Back button. Settings renders outside the
	// workbench shell, so it registers its own close action while mounted.
	useRegisterCloseAction(useCloseSettings());
	const loaderData = workbenchRouteApi.useLoaderData();
	const projects = loaderData.projects;
	const lastRepoId = useAtomValue(settingsActiveRepoIdAtom);

	const activeRepoId = useMemo(() => {
		const fromPath = pathname.match(/\/settings\/repo\/([^/]+)/)?.[1] ?? null;
		if (fromPath && projects.some((project) => project.id === fromPath)) {
			return fromPath;
		}
		if (lastRepoId && projects.some((project) => project.id === lastRepoId)) {
			return lastRepoId;
		}
		return projects[0]?.id ?? null;
	}, [lastRepoId, pathname, projects]);

	return (
		<main className='flex h-svh min-h-svh flex-col bg-background text-foreground'>
			<SettingsHeader
				activeRepoId={activeRepoId}
				projects={projects}
				scope={scope}
			/>
			<div className='flex min-h-0 flex-1 overflow-hidden'>
				<SettingsSidebar activeRepoId={activeRepoId} scope={scope} />
				<ScrollArea className='min-h-0 flex-1'>
					<Outlet />
				</ScrollArea>
			</div>
		</main>
	);
}
