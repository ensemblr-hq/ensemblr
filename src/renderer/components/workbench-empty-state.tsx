import {
	SidebarInset,
	SidebarProvider,
} from '@/renderer/components/ui/sidebar';
import { TooltipProvider } from '@/renderer/components/ui/tooltip';
import { useProjectNavigationState } from '@/renderer/state/workspace';
import type { ProjectShellModel } from '@/renderer/types/workbench';
import type {
	WorkbenchActiveView,
	WorkbenchHealth,
} from '@/renderer/types/workbench-shell';
import { WorkspaceNavigationSidebar } from './workbench-shell/navigation-sidebar';

export function WorkbenchEmptyStateShell({
	activeView,
	emptyState,
	health,
	onDashboardSelect,
	onHelpSelect,
	onHistorySelect,
	onSettingsSelect,
	onWorkspaceSelect,
	projects,
}: {
	activeView: WorkbenchActiveView;
	emptyState: {
		detail: string;
		title: string;
	};
	health: WorkbenchHealth;
	onDashboardSelect: () => void;
	onHelpSelect: () => void;
	onHistorySelect: () => void;
	onSettingsSelect: () => void;
	onWorkspaceSelect: (projectId: string, workspaceId: string) => void;
	projects: ProjectShellModel[];
}) {
	const projectNavigation = useProjectNavigationState(projects);

	return (
		<TooltipProvider>
			<SidebarProvider>
				<WorkspaceNavigationSidebar
					activeProject={null}
					activeView={activeView}
					activeWorkspace={null}
					health={health}
					onDashboardSelect={onDashboardSelect}
					onHelpSelect={onHelpSelect}
					onHistorySelect={onHistorySelect}
					onSettingsSelect={onSettingsSelect}
					onWorkspaceSelect={onWorkspaceSelect}
					projectNavigation={projectNavigation}
					projects={projects}
				/>
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
			</SidebarProvider>
		</TooltipProvider>
	);
}
