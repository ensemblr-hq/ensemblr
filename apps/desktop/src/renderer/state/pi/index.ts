/**
 * Public surface for the renderer-wide Pi runtime concern: the raw RPC frame
 * ring buffer, the debug panel toggle, and the mount-once subscription that
 * pipes incoming frames into the buffer.
 *
 * Outside this folder, import from `@/renderer/state/pi` only.
 */
export type { FrameCategory } from './pi-raw-frames';
export {
	useClearRawFrames,
	useDebugPanelToggle,
	usePiRawFrameCapture,
	useRawFrames,
} from './pi-raw-frames';
