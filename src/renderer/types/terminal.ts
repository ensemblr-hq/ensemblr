/**
 * Public renderer type for the terminal boundary. The concrete xterm.js-backed
 * adapter lives in `lib/terminal`; this interface is the swap-friendly contract
 * dock UI and session wiring depend on.
 */

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
	onData: (listener: (data: string) => void) => () => void;
	/** Live-updates the terminal typography; caller re-fits afterwards. */
	setFont: (options: { fontFamily?: string; fontSize?: number }) => void;
	/** Live-updates the scrollback buffer line limit without recreating the surface. */
	setScrollback: (lines: number) => void;
	write: (data: string) => void;
}
