import { useCallback, useState } from 'react';

import type {
	ProjectShellModel,
	WorkspaceShellModel,
} from '@/renderer/types/workbench';
import { ArchiveRepositoryDialog } from '../archive-repository-dialog';
import { ArchiveWorkspaceDialog } from '../archive-workspace-dialog';
import { BrowseArchiveDialog } from '../browse-archive-dialog';
import { CreateWorkspaceSourceDialog } from '../create-workspace-source-dialog';
import { DeleteRepositoryDialog } from '../delete-repository-dialog';
import { DeleteWorkspaceDialog } from '../delete-workspace-dialog';

export interface ProjectNavigationDialogsController {
	openArchiveProject: (project: ProjectShellModel) => void;
	openArchiveWorkspace: (workspace: WorkspaceShellModel) => void;
	openBrowseArchive: (project: ProjectShellModel) => void;
	openCreateSource: (project: ProjectShellModel) => void;
	openDeleteProject: (project: ProjectShellModel) => void;
	openDeleteWorkspace: (workspace: WorkspaceShellModel) => void;
}

interface ProjectNavigationDialogsState {
	archiveProjectTarget: ProjectShellModel | null;
	archiveWorkspaceTarget: WorkspaceShellModel | null;
	browseArchiveProject: ProjectShellModel | null;
	createSourceProject: ProjectShellModel | null;
	deleteProjectTarget: ProjectShellModel | null;
	deleteWorkspaceTarget: WorkspaceShellModel | null;
}

/**
 * Owns the open/close state for every sidebar lifecycle dialog (archive, delete,
 * create-source) and exposes setters the navigation tree can use to trigger them.
 */
export function useProjectNavigationDialogs(): {
	controller: ProjectNavigationDialogsController;
	state: ProjectNavigationDialogsState;
	setArchiveProjectTarget: (project: ProjectShellModel | null) => void;
	setArchiveWorkspaceTarget: (workspace: WorkspaceShellModel | null) => void;
	setBrowseArchiveProject: (project: ProjectShellModel | null) => void;
	setCreateSourceProject: (project: ProjectShellModel | null) => void;
	setDeleteProjectTarget: (project: ProjectShellModel | null) => void;
	setDeleteWorkspaceTarget: (workspace: WorkspaceShellModel | null) => void;
} {
	const [createSourceProject, setCreateSourceProject] =
		useState<ProjectShellModel | null>(null);
	const [archiveWorkspaceTarget, setArchiveWorkspaceTarget] =
		useState<WorkspaceShellModel | null>(null);
	const [archiveProjectTarget, setArchiveProjectTarget] =
		useState<ProjectShellModel | null>(null);
	const [browseArchiveProject, setBrowseArchiveProject] =
		useState<ProjectShellModel | null>(null);
	const [deleteWorkspaceTarget, setDeleteWorkspaceTarget] =
		useState<WorkspaceShellModel | null>(null);
	const [deleteProjectTarget, setDeleteProjectTarget] =
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
	const openBrowseArchive = useCallback((project: ProjectShellModel) => {
		setBrowseArchiveProject(project);
	}, []);
	const openDeleteWorkspace = useCallback((workspace: WorkspaceShellModel) => {
		setDeleteWorkspaceTarget(workspace);
	}, []);
	const openDeleteProject = useCallback((project: ProjectShellModel) => {
		setDeleteProjectTarget(project);
	}, []);

	return {
		controller: {
			openArchiveProject,
			openArchiveWorkspace,
			openBrowseArchive,
			openCreateSource,
			openDeleteProject,
			openDeleteWorkspace,
		},
		setArchiveProjectTarget,
		setArchiveWorkspaceTarget,
		setBrowseArchiveProject,
		setCreateSourceProject,
		setDeleteProjectTarget,
		setDeleteWorkspaceTarget,
		state: {
			archiveProjectTarget,
			archiveWorkspaceTarget,
			browseArchiveProject,
			createSourceProject,
			deleteProjectTarget,
			deleteWorkspaceTarget,
		},
	};
}

/** Mounts the sidebar lifecycle dialogs driven by the navigation actions hook. */
export function ProjectNavigationDialogs({
	archiveProjectTarget,
	archiveWorkspaceTarget,
	browseArchiveProject,
	createSourceProject,
	deleteProjectTarget,
	deleteWorkspaceTarget,
	onArchiveBrowseChange,
	onProjectArchived,
	onProjectDeleted,
	onWorkspaceArchived,
	onWorkspaceDeleted,
	orderedProjects,
	setArchiveProjectTarget,
	setArchiveWorkspaceTarget,
	setBrowseArchiveProject,
	setCreateSourceProject,
	setDeleteProjectTarget,
	setDeleteWorkspaceTarget,
}: {
	archiveProjectTarget: ProjectShellModel | null;
	archiveWorkspaceTarget: WorkspaceShellModel | null;
	browseArchiveProject: ProjectShellModel | null;
	createSourceProject: ProjectShellModel | null;
	deleteProjectTarget: ProjectShellModel | null;
	deleteWorkspaceTarget: WorkspaceShellModel | null;
	onArchiveBrowseChange: (repositoryId: string) => Promise<void>;
	onProjectArchived: (archivedProjectId: string) => Promise<void>;
	onProjectDeleted: (deletedProjectId: string) => Promise<void>;
	onWorkspaceArchived: (archivedWorkspaceId: string) => Promise<void>;
	onWorkspaceDeleted: (deletedWorkspaceId: string) => Promise<void>;
	orderedProjects: ProjectShellModel[];
	setArchiveProjectTarget: (project: ProjectShellModel | null) => void;
	setArchiveWorkspaceTarget: (workspace: WorkspaceShellModel | null) => void;
	setBrowseArchiveProject: (project: ProjectShellModel | null) => void;
	setCreateSourceProject: (project: ProjectShellModel | null) => void;
	setDeleteProjectTarget: (project: ProjectShellModel | null) => void;
	setDeleteWorkspaceTarget: (workspace: WorkspaceShellModel | null) => void;
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

			<DeleteWorkspaceDialog
				onDeleted={onWorkspaceDeleted}
				onOpenChange={(open) => {
					if (!open) {
						setDeleteWorkspaceTarget(null);
					}
				}}
				open={deleteWorkspaceTarget !== null}
				workspace={deleteWorkspaceTarget}
			/>

			<DeleteRepositoryDialog
				onDeleted={onProjectDeleted}
				onOpenChange={(open) => {
					if (!open) {
						setDeleteProjectTarget(null);
					}
				}}
				open={deleteProjectTarget !== null}
				project={deleteProjectTarget}
			/>

			<BrowseArchiveDialog
				onChange={onArchiveBrowseChange}
				onOpenChange={(open) => {
					if (!open) {
						setBrowseArchiveProject(null);
					}
				}}
				open={browseArchiveProject !== null}
				project={browseArchiveProject}
			/>
		</>
	);
}
