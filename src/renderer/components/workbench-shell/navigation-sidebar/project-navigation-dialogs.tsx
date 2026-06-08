import { useCallback, useState } from 'react';

import type {
	ProjectShellModel,
	WorkspaceShellModel,
} from '@/renderer/types/workbench';
import { ArchiveRepositoryDialog } from '../archive-repository-dialog';
import { ArchiveWorkspaceDialog } from '../archive-workspace-dialog';
import { CreateWorkspaceSourceDialog } from '../create-workspace-source-dialog';

export interface ProjectNavigationDialogsController {
	openArchiveProject: (project: ProjectShellModel) => void;
	openArchiveWorkspace: (workspace: WorkspaceShellModel) => void;
	openCreateSource: (project: ProjectShellModel) => void;
}

interface ProjectNavigationDialogsState {
	archiveProjectTarget: ProjectShellModel | null;
	archiveWorkspaceTarget: WorkspaceShellModel | null;
	createSourceProject: ProjectShellModel | null;
}

/**
 * Owns the open/close state for the three sidebar dialogs and exposes setters
 * the navigation tree can use to trigger them.
 */
export function useProjectNavigationDialogs(): {
	controller: ProjectNavigationDialogsController;
	state: ProjectNavigationDialogsState;
	setArchiveProjectTarget: (project: ProjectShellModel | null) => void;
	setArchiveWorkspaceTarget: (workspace: WorkspaceShellModel | null) => void;
	setCreateSourceProject: (project: ProjectShellModel | null) => void;
} {
	const [createSourceProject, setCreateSourceProject] =
		useState<ProjectShellModel | null>(null);
	const [archiveWorkspaceTarget, setArchiveWorkspaceTarget] =
		useState<WorkspaceShellModel | null>(null);
	const [archiveProjectTarget, setArchiveProjectTarget] =
		useState<ProjectShellModel | null>(null);

	const openCreateSource = useCallback((project: ProjectShellModel) => {
		setCreateSourceProject(project);
	}, []);
	const openArchiveWorkspace = useCallback((workspace: WorkspaceShellModel) => {
		setArchiveWorkspaceTarget(workspace);
	}, []);
	const openArchiveProject = useCallback((project: ProjectShellModel) => {
		setArchiveProjectTarget(project);
	}, []);

	return {
		controller: { openArchiveProject, openArchiveWorkspace, openCreateSource },
		setArchiveProjectTarget,
		setArchiveWorkspaceTarget,
		setCreateSourceProject,
		state: {
			archiveProjectTarget,
			archiveWorkspaceTarget,
			createSourceProject,
		},
	};
}

/** Mounts the three sidebar dialogs driven by the navigation actions hook. */
export function ProjectNavigationDialogs({
	archiveProjectTarget,
	archiveWorkspaceTarget,
	createSourceProject,
	onProjectArchived,
	onWorkspaceArchived,
	orderedProjects,
	setArchiveProjectTarget,
	setArchiveWorkspaceTarget,
	setCreateSourceProject,
}: {
	archiveProjectTarget: ProjectShellModel | null;
	archiveWorkspaceTarget: WorkspaceShellModel | null;
	createSourceProject: ProjectShellModel | null;
	onProjectArchived: (archivedProjectId: string) => Promise<void>;
	onWorkspaceArchived: (archivedWorkspaceId: string) => Promise<void>;
	orderedProjects: ProjectShellModel[];
	setArchiveProjectTarget: (project: ProjectShellModel | null) => void;
	setArchiveWorkspaceTarget: (workspace: WorkspaceShellModel | null) => void;
	setCreateSourceProject: (project: ProjectShellModel | null) => void;
}) {
	return (
		<>
			<CreateWorkspaceSourceDialog
				onOpenChange={(open) => {
					if (!open) {
						setCreateSourceProject(null);
					}
				}}
				open={createSourceProject !== null}
				project={createSourceProject}
				projects={orderedProjects}
			/>

			<ArchiveWorkspaceDialog
				onArchived={onWorkspaceArchived}
				onOpenChange={(open) => {
					if (!open) {
						setArchiveWorkspaceTarget(null);
					}
				}}
				open={archiveWorkspaceTarget !== null}
				workspace={archiveWorkspaceTarget}
			/>

			<ArchiveRepositoryDialog
				onArchived={onProjectArchived}
				onOpenChange={(open) => {
					if (!open) {
						setArchiveProjectTarget(null);
					}
				}}
				open={archiveProjectTarget !== null}
				project={archiveProjectTarget}
			/>
		</>
	);
}
