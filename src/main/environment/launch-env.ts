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
 * Returns a copy of `env` with the macOS/Electron launch-context variables
 * removed, so spawning a child can never make macOS relaunch this app. Pure:
 * the input object is not mutated. Generic in the env shape so callers keep
 * their exact type (`Record<string, string>` in, `Record<string, string>` out)
 * without an assertion at the boundary.
 * @param env - Source environment, typically `process.env` or a base env.
 * @returns A new environment object without the launch-context keys.
 */
export function stripLaunchContextEnv<T extends NodeJS.ProcessEnv>(env: T): T {
	// Spread preserves every own key of `env`, so the result is still a `T`; TS
	// can't infer that through the delete loop, hence the single localized cast.
	const sanitized = { ...env } as T;
	for (const key of LAUNCH_CONTEXT_ENV_KEYS) {
		delete sanitized[key];
	}
	return sanitized;
}
