import { useState } from 'react';
import { StatusBadge } from '@/renderer/components/status-badge';
import { ScrollArea } from '@/renderer/components/ui/scroll-area';
import {
	Sidebar,
	SidebarContent,
	SidebarFooter,
	SidebarHeader,
	SidebarRail,
	SidebarTrigger,
} from '@/renderer/components/ui/sidebar';
import { useSetupDiagnosticsOptional } from '@/renderer/components/workbench-shell/shell-contexts';
import { healthTone } from '@/renderer/lib/workbench';
import type {
	AddProjectActionId,
	AddProjectMenuModel,
	ProjectShellModel,
	RecentProject,
	WorkbenchRouteSearch,
	WorkspaceShellModel,
} from '@/renderer/types/workbench';
import type {
	ProjectNavigationState,
	WorkbenchActiveView,
	WorkbenchHealth,
	WorkbenchStaticNavigationTarget,
} from '@/renderer/types/workbench-shell';
import type { SetupDiagnosticsSnapshot } from '@/shared/ipc/contracts/setup';
import { RenameWorkspaceDialog } from '../rename-workspace-dialog';

import { PinnedWorkspaceGroup } from './pinned-workspace-group';
import { ProjectNavigationGroups } from './project-navigation-groups';
import { SidebarPrimaryNavigation } from './sidebar-primary-navigation';

/** Off-canvas workbench sidebar housing primary nav, pins, projects, and health. */
export function WorkspaceNavigationSidebar({
	activeProject,
	activeView,
	activeWorkspace,
	addProjectMenu,
	health,
	onAddProject,
	onOpenRecentProject,
	onStaticNavigationSelect,
	onWorkspaceSelect,
	projectNavigation,
	projects,
	resolveWorkspaceRouteSearch,
}: {
	activeProject: ProjectShellModel | null;
	activeView: WorkbenchActiveView;
	activeWorkspace: WorkspaceShellModel | null;
	addProjectMenu?: AddProjectMenuModel;
	health: WorkbenchHealth;
	onAddProject?: (action: AddProjectActionId) => void;
	onOpenRecentProject?: (recent: RecentProject) => void;
	onStaticNavigationSelect: (target: WorkbenchStaticNavigationTarget) => void;
	onWorkspaceSelect: (projectId: string, workspaceId: string) => void;
	projectNavigation: ProjectNavigationState;
	projects: ProjectShellModel[];
	resolveWorkspaceRouteSearch: (
		workspace: WorkspaceShellModel,
	) => WorkbenchRouteSearch;
}) {
	const activeNavigationProject =
		activeView === 'workspace' ? activeProject : null;
	const activeNavigationWorkspace =
		activeView === 'workspace' ? activeWorkspace : null;
	const [renameWorkspaceTarget, setRenameWorkspaceTarget] =
		useState<WorkspaceShellModel | null>(null);

	return (
		<Sidebar className='border-sidebar-border' collapsible='offcanvas'>
			<SidebarHeader className='h-12 border-sidebar-border border-b p-0'>
				<div className='macos-traffic-light-spacer flex h-full shrink-0 items-center justify-end px-2'>
					<SidebarTrigger />
				</div>
			</SidebarHeader>

			<SidebarContent className='overflow-visible'>
				<SidebarPrimaryNavigation
					activeView={activeView}
					onStaticNavigationSelect={onStaticNavigationSelect}
				/>
				<ScrollArea className='flex min-h-0 flex-1 flex-col'>
					<PinnedWorkspaceGroup
						activeProject={activeNavigationProject}
						activeWorkspace={activeNavigationWorkspace}
						onWorkspaceRenameSelect={setRenameWorkspaceTarget}
						onWorkspaceSelect={onWorkspaceSelect}
						projectNavigation={projectNavigation}
						resolveWorkspaceRouteSearch={resolveWorkspaceRouteSearch}
					/>
					<ProjectNavigationGroups
						activeProject={activeNavigationProject}
						activeWorkspace={activeNavigationWorkspace}
						addProjectMenu={addProjectMenu}
						onAddProject={onAddProject}
						onOpenRecentProject={onOpenRecentProject}
						onStaticNavigationSelect={onStaticNavigationSelect}
						onWorkspaceRenameSelect={setRenameWorkspaceTarget}
						onWorkspaceSelect={onWorkspaceSelect}
						projectNavigation={projectNavigation}
						resolveWorkspaceRouteSearch={resolveWorkspaceRouteSearch}
					/>
				</ScrollArea>
			</SidebarContent>

			<SidebarHealthFooter health={health} projects={projects} />
			<SidebarRail />
			<RenameWorkspaceDialog
				onOpenChange={(open) => {
					if (!open) {
						setRenameWorkspaceTarget(null);
					}
				}}
				open={renameWorkspaceTarget !== null}
				workspace={renameWorkspaceTarget}
			/>
		</Sidebar>
	);
}

/**
 * Bottom-of-sidebar footer: app health badge plus a single-line setup status
 * with a deep link to /settings/diagnostics. This is the ONLY place in the
 * shell where setup/blocked counts surface outside the diagnostics screen —
 * the chat tab stays free of any diagnostic UI.
 */
function SidebarHealthFooter({
	health,
	projects,
}: {
	health: WorkbenchHealth;
	projects: ProjectShellModel[];
}) {
	const repositoryCount = projects.length;
	const workspaceCount = projects.reduce(
		(count, project) => count + project.workspaces.length,
		0,
	);
	const setupContext = useSetupDiagnosticsOptional();
	const setupLine = describeSetupLine(
		setupContext?.state.setupDiagnostics ?? null,
	);

	return (
		<SidebarFooter className='border-sidebar-border border-t p-2'>
			<div className='flex flex-col gap-1 rounded-md px-2 py-1.5'>
				<StatusBadge tone={healthTone[health.state]}>
					{health.label}
				</StatusBadge>
				<div className='flex items-center gap-2 font-mono text-muted-foreground text-xxs leading-4'>
					<span>{repositoryCount} repos</span>
					<span>{workspaceCount} workspaces</span>
				</div>
				<p className='line-clamp-2 text-muted-foreground text-xxs leading-4'>
					{health.detail}
				</p>
				{setupLine ? (
					<a
						className='text-status-warning text-xxs leading-4 underline-offset-2 hover:underline'
						data-sidebar-setup-status='blocked'
						href='#/settings/diagnostics'
					>
						{setupLine}
					</a>
				) : null}
			</div>
		</SidebarFooter>
	);
}

/**
 * Derive the sidebar footer status line from a setup-diagnostics snapshot.
 * @param snapshot - The latest setup-diagnostics snapshot, or null when none.
 * @returns The status line, or null when setup is ready and nothing needs surfacing.
 */
function describeSetupLine(
	snapshot: SetupDiagnosticsSnapshot | null,
): string | null {
	if (!snapshot || snapshot.status === 'ready') {
		return null;
	}
	if (snapshot.status === 'checking') {
		return 'Setup checks running…';
	}
	const blocked = snapshot.blockedCount ?? 0;
	if (blocked > 0) {
		return `${blocked} setup check${blocked === 1 ? '' : 's'} blocked — open diagnostics`;
	}
	return 'Setup not ready — open diagnostics';
}
