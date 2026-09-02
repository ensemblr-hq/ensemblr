import { useCallback, useState } from 'react';
import type {
	ProjectShellModel,
	WorkspaceCreationSeed,
	WorkspaceShellModel,
} from '@/renderer/types/workbench';
import { BrowseArchiveDialog } from '../browse-archive-dialog';
import { CreateWorkspaceSourceDialog } from '../create-workspace-source-dialog';
import { DeleteRepositoryDialog } from '../delete-repository-dialog';
import { DeleteWorkspaceDialog } from '../delete-workspace-dialog';

/** Openers for each sidebar lifecycle dialog (delete, browse-archive, create-source). */
interface ProjectNavigationDialogsController {
	openBrowseArchive: (project: ProjectShellModel) => void;
	openCreateSource: (project: ProjectShellModel) => void;
	openDeleteProject: (project: ProjectShellModel) => void;
	openDeleteWorkspace: (workspace: WorkspaceShellModel) => void;
}

/** Current target project or workspace for each sidebar lifecycle dialog. */
interface ProjectNavigationDialogsState {
	browseArchiveProject: ProjectShellModel | null;
	createSourceProject: ProjectShellModel | null;
	deleteProjectTarget: ProjectShellModel | null;
	deleteWorkspaceTarget: WorkspaceShellModel | null;
}

/**
 * Owns the open/close state for every sidebar lifecycle dialog (delete,
 * browse-archive, create-source) and exposes setters the navigation tree can use
 * to trigger them.
 */
export function useProjectNavigationDialogs(): {
	controller: ProjectNavigationDialogsController;
	state: ProjectNavigationDialogsState;
	setBrowseArchiveProject: (project: ProjectShellModel | null) => void;
	setCreateSourceProject: (project: ProjectShellModel | null) => void;
	setDeleteProjectTarget: (project: ProjectShellModel | null) => void;
	setDeleteWorkspaceTarget: (workspace: WorkspaceShellModel | null) => void;
} {
	const [createSourceProject, setCreateSourceProject] =
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
			openBrowseArchive,
			openCreateSource,
			openDeleteProject,
			openDeleteWorkspace,
		},
		setBrowseArchiveProject,
		setCreateSourceProject,
		setDeleteProjectTarget,
		setDeleteWorkspaceTarget,
		state: {
			browseArchiveProject,
			createSourceProject,
			deleteProjectTarget,
			deleteWorkspaceTarget,
		},
	};
}

/** Mounts the sidebar lifecycle dialogs driven by the navigation actions hook. */
export function ProjectNavigationDialogs({
	browseArchiveProject,
	createSourceProject,
	deleteProjectTarget,
	deleteWorkspaceTarget,
	onArchiveBrowseChange,
	onCreateWorkspaceFromSource,
	onOpenWorkspace,
	onProjectDeleted,
	onWorkspaceDeleted,
	orderedProjects,
	setBrowseArchiveProject,
	setCreateSourceProject,
	setDeleteProjectTarget,
	setDeleteWorkspaceTarget,
}: {
	browseArchiveProject: ProjectShellModel | null;
	createSourceProject: ProjectShellModel | null;
	deleteProjectTarget: ProjectShellModel | null;
	deleteWorkspaceTarget: WorkspaceShellModel | null;
	onArchiveBrowseChange: (repositoryId: string) => Promise<void>;
	onCreateWorkspaceFromSource?: (
		project: ProjectShellModel,
		seed: WorkspaceCreationSeed,
	) => void;
	onOpenWorkspace?: (project: ProjectShellModel, workspaceId: string) => void;
	onProjectDeleted: (deletedProjectId: string) => Promise<void>;
	onWorkspaceDeleted: (deletedWorkspaceId: string) => Promise<void>;
	orderedProjects: ProjectShellModel[];
	setBrowseArchiveProject: (project: ProjectShellModel | null) => void;
	setCreateSourceProject: (project: ProjectShellModel | null) => void;
	setDeleteProjectTarget: (project: ProjectShellModel | null) => void;
	setDeleteWorkspaceTarget: (workspace: WorkspaceShellModel | null) => void;
}) {
	return (
		<>
			<CreateWorkspaceSourceDialog
				onCreateWorkspace={({ repoId, seed }) => {
					const project = orderedProjects.find(
						(candidate) => candidate.id === repoId,
					);
					if (project) {
						onCreateWorkspaceFromSource?.(project, seed);
					}
				}}
				onOpenChange={(open) => {
					if (!open) {
						setCreateSourceProject(null);
					}
				}}
				onOpenWorkspace={({ repoId, workspaceId }) => {
					const project = orderedProjects.find(
						(candidate) => candidate.id === repoId,
					);
					if (project) {
						onOpenWorkspace?.(project, workspaceId);
					}
				}}
				open={createSourceProject !== null}
				project={createSourceProject}
				projects={orderedProjects}
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
