import type {
	ProjectShellModel,
	WorkspaceShellModel,
} from '@/renderer/types/workbench';

/**
 * A path the Concierge wrote in prose, placed against the workspace that can
 * show it.
 */
export interface ConciergeFileTarget {
	/**
	 * What the preview tab reads: workspace-relative for a file inside the
	 * worktree, and the absolute path for one the project owns outside it.
	 */
	filePath: string;
	projectId: string;
	workspaceId: string;
}

/**
 * Places an absolute path the Concierge wrote against the workspace whose
 * worktree holds it, so a chip in its transcript can open the file where the
 * user would otherwise have to go looking for it.
 *
 * The Concierge belongs to no workspace, so unlike a workspace chat there is no
 * cwd to relativize against and no file tree to check membership in — the
 * absolute path is the only thing that says which project a file belongs to.
 * A relative path is therefore refused rather than guessed at: `README.md` names
 * a file in every project at once, and opening the wrong one is worse than
 * leaving the span as prose.
 *
 * A path under a *repository* root rather than a worktree — the base checkout,
 * which no route can show on its own — borrows a workspace of that project and
 * keeps its absolute form, so the preview reads the repository's own file
 * instead of a same-named one in the worktree.
 * @param projects - Every project the shell knows, with their workspaces
 * @param candidatePath - Path exactly as the Concierge wrote it
 * @returns The workspace to focus and the path to preview there, or null
 */
export function resolveConciergeFileTarget(
	projects: readonly ProjectShellModel[],
	candidatePath: string,
): ConciergeFileTarget | null {
	const absolutePath = toAbsolutePath(candidatePath);
	if (!absolutePath) {
		return null;
	}
	return (
		findInWorktree(projects, absolutePath) ??
		findInRepository(projects, absolutePath)
	);
}

/**
 * Canonicalizes a path to the `/a/b` form roots are compared in, refusing
 * anything that is not absolute. `~` is left out deliberately: expanding it
 * needs the home directory, which the renderer does not have.
 * @param candidatePath - Path as written
 * @returns The normalized absolute path, or null when it is not absolute
 */
function toAbsolutePath(candidatePath: string): string | null {
	const trimmed = candidatePath.trim();
	if (!trimmed.startsWith('/')) {
		return null;
	}
	const segments: string[] = [];
	for (const segment of trimmed.split('/')) {
		if (segment === '' || segment === '.') {
			continue;
		}
		if (segment === '..') {
			segments.pop();
			continue;
		}
		segments.push(segment);
	}
	return segments.length > 0 ? `/${segments.join('/')}` : null;
}

/**
 * Returns the part of `absolutePath` that sits under `root`, or null when the
 * path is the root itself or lives elsewhere. Comparing on the separator is what
 * keeps `/root/app-notes` from reading as a file inside `/root/app`.
 * @param root - Absolute root directory
 * @param absolutePath - Absolute path being placed
 * @returns The path relative to the root, or null
 */
function relativeToRoot(root: string, absolutePath: string): string | null {
	const normalizedRoot = root.replace(/\/+$/, '');
	if (!normalizedRoot || !absolutePath.startsWith(`${normalizedRoot}/`)) {
		return null;
	}
	return absolutePath.slice(normalizedRoot.length + 1);
}

/** Workspaces that exist on disk, so a path is never placed in a pending row. */
function openableWorkspaces(
	project: ProjectShellModel,
): readonly WorkspaceShellModel[] {
	return project.workspaces.filter((workspace) => !workspace.isPendingCreation);
}

/**
 * Finds the workspace whose worktree holds the path. The deepest matching root
 * wins, so a worktree nested under another project's tree resolves to itself.
 * @param projects - Every project the shell knows
 * @param absolutePath - Normalized absolute path
 * @returns The target, or null when no worktree holds it
 */
function findInWorktree(
	projects: readonly ProjectShellModel[],
	absolutePath: string,
): ConciergeFileTarget | null {
	let best: { depth: number; target: ConciergeFileTarget } | null = null;
	for (const project of projects) {
		for (const workspace of openableWorkspaces(project)) {
			const filePath = relativeToRoot(workspace.pathLabel, absolutePath);
			if (filePath === null) {
				continue;
			}
			const depth = workspace.pathLabel.length;
			if (best && best.depth >= depth) {
				continue;
			}
			best = {
				depth,
				target: { filePath, projectId: project.id, workspaceId: workspace.id },
			};
		}
	}
	return best?.target ?? null;
}

/**
 * Finds a workspace to show a file the project's base checkout holds, keeping
 * the absolute path so the preview reads the repository rather than the
 * worktree.
 * @param projects - Every project the shell knows
 * @param absolutePath - Normalized absolute path
 * @returns The target, or null when no project owns the path or has a workspace
 */
function findInRepository(
	projects: readonly ProjectShellModel[],
	absolutePath: string,
): ConciergeFileTarget | null {
	let best: { depth: number; target: ConciergeFileTarget } | null = null;
	for (const project of projects) {
		if (relativeToRoot(project.pathLabel, absolutePath) === null) {
			continue;
		}
		const workspace = mostRecentWorkspace(project);
		const depth = project.pathLabel.length;
		if (!workspace || (best && best.depth >= depth)) {
			continue;
		}
		best = {
			depth,
			target: {
				filePath: absolutePath,
				projectId: project.id,
				workspaceId: workspace.id,
			},
		};
	}
	return best?.target ?? null;
}

/**
 * Picks the workspace a repository file is shown in: the one worked on last, so
 * the jump lands where the user already was rather than in whichever row the
 * sidebar happens to list first.
 * @param project - Project owning the file
 * @returns The workspace to borrow, or null when the project has none
 */
function mostRecentWorkspace(
	project: ProjectShellModel,
): WorkspaceShellModel | null {
	let best: WorkspaceShellModel | null = null;
	for (const workspace of openableWorkspaces(project)) {
		if (!best || (workspace.updatedAt ?? '') > (best.updatedAt ?? '')) {
			best = workspace;
		}
	}
	return best;
}
