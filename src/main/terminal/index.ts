export type {
	PtyBackend,
	PtyProcess,
	PtySpawnOptions,
} from './pty-backend';
export { createNodePtyBackend } from './pty-backend';
export { toReadableScrollback } from './scrollback-text';
export type { TerminalScrollbackCapture } from './terminal-output-file';
export { writeArchivedTerminalOutput } from './terminal-output-file';
export type { ScrollbackBuffer } from './terminal-scrollback';
export {
	createScrollbackBuffer,
	DEFAULT_SCROLLBACK_LIMIT,
} from './terminal-scrollback';
export type {
	CreateTerminalServiceOptions,
	CreateTerminalSessionOptions,
	TerminalService,
	TerminalServiceErrorCode,
} from './terminal-service';
export {
	createTerminalService,
	TerminalServiceError,
} from './terminal-service';
export { resolveUserShell } from './user-shell';
