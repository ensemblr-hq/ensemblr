import type { LocalCommandService } from '../commands/command-types.ts';

/**
 * Builds the resolver that hands the workspace-environment service a workspace
 * directory's version-manager-aware `PATH`. Setup and run scripts spawn through
 * a non-interactive POSIX shell that never activates mise/fnm/asdf, so they must
 * inherit the login-shell PATH captured for the workspace directory instead of
 * the app's global one.
 *
 * Returns null when the login shell could not be consulted — a `fallback`
 * snapshot carries the app's inherited PATH, which the caller already has — so
 * the workspace environment keeps the inherited PATH rather than overwriting it
 * with an identical value.
 * @param localCommandService - Service whose `getEnvironment` captures and
 * memoizes the per-directory login-shell environment.
 * @returns A resolver from workspace directory to its toolchain PATH, or null.
 */
export function createToolchainPathResolver(
	localCommandService: Pick<LocalCommandService, 'getEnvironment'>,
): (cwd: string) => Promise<string | null> {
	return async (cwd) => {
		const snapshot = await localCommandService.getEnvironment(cwd);
		return snapshot.source === 'shell' ? snapshot.path : null;
	};
}
