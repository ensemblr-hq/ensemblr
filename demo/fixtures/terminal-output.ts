/**
 * Scrollback for the dock's terminals. Written with real ANSI escapes rather
 * than plain text: the renderer attaches xterm to this exactly as it attaches to
 * a live PTY, so the colours, the box drawing, and the cursor positioning are
 * the terminal's own rendering rather than a styled stand-in.
 */

const RESET = '[0m';
const DIM = '[2m';
const BOLD = '[1m';
const GREEN = '[32m';
const CYAN = '[36m';
const MAGENTA = '[35m';
const YELLOW = '[33m';

/** A Vite dev server mid-run, which is what the Run tab shows most often. */
export const DEV_SERVER_OUTPUT = [
	`${DIM}$ npm run dev${RESET}`,
	'',
	`  ${GREEN}${BOLD}VITE${RESET} ${GREEN}v8.2.2${RESET}  ${DIM}ready in 412 ms${RESET}`,
	'',
	`  ${GREEN}➜${RESET}  ${BOLD}Local${RESET}:   ${CYAN}http://localhost:5173/${RESET}`,
	`  ${GREEN}➜${RESET}  ${BOLD}Network${RESET}: ${DIM}use --host to expose${RESET}`,
	'',
	`${DIM}11:19:44${RESET} ${CYAN}[vite]${RESET} hmr update ${GREEN}/src/renderer/components/settings/updates-panel.tsx${RESET}`,
	`${DIM}11:19:52${RESET} ${CYAN}[vite]${RESET} hmr update ${GREEN}/src/main/updates/update-service.ts${RESET}`,
	`${DIM}11:20:03${RESET} ${CYAN}[vite]${RESET} page reload ${DIM}src/shared/ipc/contracts/update.ts${RESET}`,
	'',
].join('\r\n');

/** A passing test run, for a shot that wants a green terminal. */
export const TEST_RUN_OUTPUT = [
	`${DIM}$ npm run test:updates${RESET}`,
	'',
	` ${MAGENTA}RUN${RESET}  ${DIM}v4.1.11${RESET}`,
	'',
	` ${GREEN}✓${RESET} tests/main/update-service.test.ts ${DIM}(12 tests) 184ms${RESET}`,
	` ${GREEN}✓${RESET} tests/renderer/updates-panel.test.tsx ${DIM}(7 tests) 233ms${RESET}`,
	'',
	` Test Files  ${GREEN}2 passed${RESET} ${DIM}(2)${RESET}`,
	`      Tests  ${GREEN}19 passed${RESET} ${DIM}(19)${RESET}`,
	`   Duration  ${DIM}1.42s${RESET}`,
	'',
	`${DIM}$ ${RESET}`,
].join('\r\n');

/** A setup script that finished, for the dock's Setup tab. */
export const SETUP_SCRIPT_OUTPUT = [
	`${DIM}$ npm ci${RESET}`,
	'',
	`${DIM}added 1284 packages in 22s${RESET}`,
	'',
	`${GREEN}✓${RESET} Setup finished ${DIM}in 24.1s${RESET}`,
	'',
].join('\r\n');

/**
 * A Claude Code harness working inside a terminal tab, for the shot that shows
 * an agent driving a harness rather than a script.
 */
export const HARNESS_OUTPUT = [
	`${DIM}$ claude --permission-mode acceptEdits${RESET}`,
	'',
	`${MAGENTA}✻${RESET} ${BOLD}Claude Code${RESET} ${DIM}v2.1.251${RESET}`,
	`  ${DIM}~/Code/workspaces/ensemblr/release-notes${RESET}`,
	'',
	`${GREEN}⏺${RESET} Backfilling the ${BOLD}ru${RESET} and ${BOLD}el${RESET} values the new keys left empty.`,
	'',
	`  ${GREEN}✓${RESET} ${DIM}Update${RESET} locales/ru/settings.json ${DIM}(4 keys)${RESET}`,
	`  ${GREEN}✓${RESET} ${DIM}Update${RESET} locales/el/settings.json ${DIM}(4 keys)${RESET}`,
	`  ${CYAN}⟳${RESET} ${DIM}Bash${RESET} npm run i18n:status`,
	'',
].join('\r\n');

/** An interactive shell, for a terminal tab that is not running a script. */
export const SHELL_OUTPUT = [
	`${DIM}psoldunov@studio${RESET} ${CYAN}release-notes${RESET} ${YELLOW}git:(release-notes-in-updates-panel)${RESET}`,
	`${DIM}$ git status --short${RESET}`,
	` ${YELLOW}M${RESET} src/main/updates/update-service.ts`,
	` ${YELLOW}M${RESET} src/renderer/components/settings/updates-panel.tsx`,
	`${GREEN}A${RESET}  tests/main/update-service.test.ts`,
	'',
	`${DIM}$ ${RESET}`,
].join('\r\n');
