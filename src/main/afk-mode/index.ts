/**
 * Public surface of the main-process AFK concern: the per-session registry the
 * IPC layer writes and the control layer reads.
 */
export {
	type AfkModeRegistry,
	createAfkModeRegistry,
} from './afk-mode-registry.ts';
