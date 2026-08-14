/**
 * Stands in for the `electron` module across the Vitest suites.
 *
 * The `tests/main/**` suites wired into `vitest.config.mts` are pure logic on the
 * `node` environment, but the ones that reach `src/main/agent-control/index.ts`
 * pull in `main-integration.ts` through the concern's barrel, and that module
 * imports `electron` at module scope. Outside an Electron process the real module
 * resolves to the packaged binary and downloads it on demand, so importing it
 * turned a hermetic unit test into a ~100 MB network fetch that fails the run when
 * the download does. No suite on this path calls an Electron API — with the real
 * module they would already crash, since it exports a path string rather than the
 * namespace — so every member here throws instead of pretending to work.
 */

/**
 * Reports that an Electron API was reached from a suite that cannot provide one.
 * @param member - Dotted name of the API that was called
 */
const unavailable = (member: string): never => {
	throw new Error(
		`electron.${member} is unavailable under Vitest. Mock it in the suite, or move the test to an "electron --test" script.`,
	);
};

/** Window manager stub; suites that need a focused window mock `electron` themselves. */
export const BrowserWindow = {
	/** Refuses the lookup rather than inventing a window the suite has no renderer for. */
	getFocusedWindow: () => unavailable('BrowserWindow.getFocusedWindow'),
};

/** Native dialog stub; a suite that expects a dialog result mocks `electron` itself. */
export const dialog = {
	/** Refuses the prompt rather than resolving a choice the user never made. */
	showMessageBox: () => unavailable('dialog.showMessageBox'),
};
