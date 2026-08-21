/**
 * Public renderer types for the terminal boundary. The concrete xterm.js-backed
 * adapter lives in `lib/terminal`; these are the swap-friendly contracts dock
 * UI and session wiring depend on.
 */

/** Raw terminal keystroke payload published to renderer-local input listeners. */
export interface TerminalInputEventDetail {
	data: string;
	terminalId: string;
}

/**
 * Renderer-side terminal boundary. Components talk to this interface only so
 * the underlying renderer (xterm.js today) can be swapped without touching
 * dock UI or session wiring.
 */
export interface TerminalRendererAdapter {
	attach: (element: HTMLElement) => void;
	clear: () => void;
	dispose: () => void;
	fit: () => { cols: number; rows: number } | null;
	focus: () => void;
	/** The text the user has selected in the surface; empty when nothing is selected. */
	getSelection: () => string;
	onData: (listener: (data: string) => void) => () => void;
	/** Live-updates the terminal typography; caller re-fits afterwards. */
	setFont: (options: { fontFamily?: string; fontSize?: number }) => void;
	/** Live-updates the scrollback buffer line limit without recreating the surface. */
	setScrollback: (lines: number) => void;
	write: (data: string) => void;
}
