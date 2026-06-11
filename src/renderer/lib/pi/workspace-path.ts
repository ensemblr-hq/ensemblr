/**
 * Normalizes a tool-reported file path to workspace-relative form. Tool
 * inputs may carry absolute paths; the read-file IPC expects paths relative
 * to the workspace cwd, so the cwd prefix is stripped when present.
 */
export function toWorkspaceRelativePath(
	filePath: string,
	workspaceCwd: string | null,
): string {
	if (workspaceCwd && filePath.startsWith(`${workspaceCwd}/`)) {
		return filePath.slice(workspaceCwd.length + 1);
	}
	return filePath;
}
