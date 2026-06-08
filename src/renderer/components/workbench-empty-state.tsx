import { SidebarInset } from '@/renderer/components/ui/sidebar';
import { WorkbenchFrame } from '@/renderer/components/workbench-shell/frame';
import { NavigationProvider } from '@/renderer/components/workbench-shell/shell-contexts';
import { useRouteProfilerMount } from '@/renderer/lib/instrumentation/route-profiler';
import type { NavigationContextValue } from '@/renderer/types/contexts';
import type {
	ProjectShellModel,
	WorkbenchRouteSearch,
} from '@/renderer/types/workbench';
import type {
	WorkbenchActiveView,
	WorkbenchHealth,
	WorkbenchStaticNavigationTarget,
} from '@/renderer/types/workbench-shell';

const EMPTY_NAVIGATION: NavigationContextValue = {
	renderStaticLink: undefined,
	renderWorkspaceLink: undefined,
};

/** Full workbench shell rendered when no workspace is selectable. */
export function WorkbenchEmptyStateShell({
	activeView,
	emptyState,
	health,
	navigation = EMPTY_NAVIGATION,
	onStaticNavigationSelect,
	onWorkspaceSelect,
	projects,
}: {
	activeView: WorkbenchActiveView;
	emptyState: {
		detail: string;
		title: string;
	};
	health: WorkbenchHealth;
	navigation?: NavigationContextValue;
	onStaticNavigationSelect: (target: WorkbenchStaticNavigationTarget) => void;
	onWorkspaceSelect: (projectId: string, workspaceId: string) => void;
	projects: ProjectShellModel[];
}) {
	useRouteProfilerMount('WorkbenchEmptyStateShell');

	return (
		<NavigationProvider value={navigation}>
			<WorkbenchFrame
				activeProject={null}
				activeView={activeView}
				activeWorkspace={null}
				health={health}
				onStaticNavigationSelect={onStaticNavigationSelect}
				onWorkspaceSelect={onWorkspaceSelect}
				projects={projects}
				resolveWorkspaceRouteSearch={resolveEmptyStateWorkspaceRouteSearch}
			>
				<WorkbenchEmptyStateContent emptyState={emptyState} />
			</WorkbenchFrame>
		</NavigationProvider>
	);
}

/** Inner content for the workbench empty state — title + detail copy. */
export function WorkbenchEmptyStateContent({
	emptyState,
}: {
	emptyState: {
		detail: string;
		title: string;
	};
}) {
	useRouteProfilerMount('WorkbenchEmptyStateContent');

	return (
		<SidebarInset className='flex h-svh min-h-svh overflow-hidden bg-background text-foreground'>
			<main className='flex min-h-0 flex-1 items-center justify-center px-8 py-10'>
				<section className='max-w-md text-center'>
					<h1 className='font-semibold text-2xl text-foreground tracking-normal'>
						{emptyState.title}
					</h1>
					<p className='mt-3 text-muted-foreground text-sm leading-6'>
						{emptyState.detail}
					</p>
				</section>
			</main>
		</SidebarInset>
	);
}

/** Empty-state mode does not surface workspace search params. */
function resolveEmptyStateWorkspaceRouteSearch(): WorkbenchRouteSearch {
	return {};
}
