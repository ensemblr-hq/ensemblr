/**
 * Normalizes a tool-reported file path to workspace-relative form. Tool
 * inputs may carry absolute paths; the read-file IPC expects paths relative
 * to the workspace cwd, so the cwd prefix is stripped when present.
 */
function toWorkspaceRelativePath(
	filePath: string,
	workspaceCwd: string | null,
): string {
	if (workspaceCwd && filePath.startsWith(`${workspaceCwd}/`)) {
		return filePath.slice(workspaceCwd.length + 1);
	}
	return filePath;
}

/**
 * Canonicalizes a path into the workspace-relative, trailing-slash-free shape
 * the file tree keys on, so chip lookups and directory reveals compare equal.
 * @param filePath - Absolute or workspace-relative path from a chip.
 * @param workspaceCwd - Absolute workspace root when known.
 * @returns Workspace-relative path without trailing slashes.
 */
export function toWorkspaceLookupPath(
	filePath: string,
	workspaceCwd: string | null,
): string {
	return toWorkspaceRelativePath(filePath, workspaceCwd).replace(/\/+$/, '');
}
