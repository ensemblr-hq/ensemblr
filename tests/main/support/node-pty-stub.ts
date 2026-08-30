/**
 * Stands in for the `node-pty` module across the Vitest suites.
 *
 * `node-pty` is a native module and ships prebuilds for darwin and win32 only —
 * there is no `linux-x64` one, and `allowScripts` sets `node-pty: false`, so npm
 * never builds it either. On macOS the darwin prebuild made that invisible; the
 * Linux CI leg this repo now runs has no binding to load, and the ~26 suites
 * that reach `src/main/terminal/pty-backend.ts` through the agent-control
 * barrel failed at import with `Failed to load native module: pty.node`.
 *
 * Stubbing it is the fix rather than compiling a binding in CI, for the same
 * reason `electron` is stubbed beside this file: no suite on that path spawns a
 * PTY. They import a barrel that happens to reach one. Every member throws, so a
 * suite that genuinely needs terminal behaviour fails loudly here instead of
 * silently exercising a fake — those live on the `electron --test` scripts,
 * which load the real module.
 */

/**
 * Reports that a `node-pty` API was reached from a suite that cannot provide one.
 * @param member - Name of the API that was called
 */
const unavailable = (member: string): never => {
	throw new Error(
		`node-pty.${member} is unavailable under Vitest. Mock it in the suite, or move the test to an "electron --test" script.`,
	);
};

/** Refuses to fork a PTY; suites needing one mock `node-pty` themselves. */
export const spawn = (): never => unavailable('spawn');
