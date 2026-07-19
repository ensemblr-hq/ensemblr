import path from 'node:path';

/** Validated absolute workspace cwd, or a renderer-facing rejection message. */
export type ResolvedWorkspaceCwd =
	| { cwd: string; ok: true }
	| { message: string; ok: false };

/**
 * Validates and normalizes an absolute workspace cwd supplied by the renderer.
 * @param workspaceCwd - Candidate absolute path from an IPC request.
 * @returns The trimmed absolute cwd, or a rejection with a user-facing message.
 */
export function resolveWorkspaceCwd(
	workspaceCwd: string,
): ResolvedWorkspaceCwd {
	const cwd = workspaceCwd?.trim();
	if (!cwd || !path.isAbsolute(cwd)) {
		return {
			message: 'Workspace path must be an absolute filesystem path.',
			ok: false,
		};
	}
	return { cwd, ok: true };
}
