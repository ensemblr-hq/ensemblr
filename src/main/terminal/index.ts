export type {
	PtyBackend,
	PtyProcess,
	PtySpawnOptions,
} from './pty-backend';
export { createNodePtyBackend } from './pty-backend';
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
