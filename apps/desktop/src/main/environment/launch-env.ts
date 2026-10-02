/**
 * Environment variables that macOS and Electron inject at GUI launch and that
 * must be dropped before spawning any child process.
 *
 * `__CFBundleIdentifier` and `XPC_SERVICE_NAME` are the dangerous ones: macOS
 * sets them to the launching app's bundle id (`dev.ensemblr.app`) and launchd
 * application-instance identity (`application.dev.ensemblr.app.<asn>`). A child
 * that inherits either and later touches LaunchServices — a terminal running
 * `open`, an agent opening a file, a dev Electron run, a tool shelling out — is
 * treated as *that* bundle, so macOS attributes it to (or relaunches) Ensemblr
 * and a stray second Dock instance flashes in. `XPC_FLAGS` and
 * `LaunchInstanceID` travel with the same launchd context. The `ELECTRON_*`
 * markers steer a child Electron/Node process into behavior meant only for
 * this process and have no business downstream.
 */
const LAUNCH_CONTEXT_ENV_KEYS = [
	'__CFBundleIdentifier',
	'ELECTRON_RUN_AS_NODE',
	'ELECTRON_NO_ATTACH_CONSOLE',
	'ELECTRON_NO_ASAR',
	'LaunchInstanceID',
	'XPC_FLAGS',
	'XPC_SERVICE_NAME',
] as const;

/**
 * Repository-local context reported by `git rev-parse --local-env-vars`, plus
 * namespace and discovery overrides documented by git(1). These override cwd
 * or change which index, objects, refs, or configuration a child operates on.
 */
const GIT_CONTEXT_ENV_KEYS: ReadonlySet<string> = new Set([
	'GIT_ALTERNATE_OBJECT_DIRECTORIES',
	'GIT_CEILING_DIRECTORIES',
	'GIT_COMMON_DIR',
	'GIT_CONFIG',
	'GIT_CONFIG_COUNT',
	'GIT_CONFIG_PARAMETERS',
	'GIT_DIR',
	'GIT_DISCOVERY_ACROSS_FILESYSTEM',
	'GIT_GRAFT_FILE',
	'GIT_IMPLICIT_WORK_TREE',
	'GIT_INDEX_FILE',
	'GIT_NAMESPACE',
	'GIT_NO_REPLACE_OBJECTS',
	'GIT_OBJECT_DIRECTORY',
	'GIT_PREFIX',
	'GIT_REPLACE_REF_BASE',
	'GIT_SHALLOW_FILE',
	'GIT_WORK_TREE',
]);

/**
 * Removes inherited app identity and Git repository context so children use
 * their assigned cwd rather than a parent's checkout, index, or ref namespace.
 * Git identity, editor, and authentication settings remain intact. Apply after
 * merging overlays; private Git operations may then supply their own temp index.
 * @param env - Assembled environment to sanitize without mutating it.
 * @returns A copy without launch identity or repository-local Git overrides.
 */
export function stripLaunchContextEnv<T extends NodeJS.ProcessEnv>(env: T): T {
	const sanitized = { ...env };
	for (const key of LAUNCH_CONTEXT_ENV_KEYS) {
		delete sanitized[key];
	}
	for (const key of Object.keys(sanitized)) {
		if (
			GIT_CONTEXT_ENV_KEYS.has(key) ||
			/^GIT_CONFIG_(?:KEY|VALUE)_\d+$/.test(key)
		) {
			delete sanitized[key];
		}
	}
	return sanitized;
}
