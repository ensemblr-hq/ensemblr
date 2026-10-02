/**
 * The clipboard and history operations a renderer surface can ask the main
 * process to run on its behalf.
 *
 * They are named after the `WebContents` edit methods they map onto, because
 * running them there rather than in the renderer is the point: Chromium blocks
 * `document.execCommand('paste')` outright, and a paste synthesized from
 * clipboard text would bypass the composer's paste handler — the one that turns
 * a long paste into a chip. Going through `WebContents` fires the real edit
 * command, so every surface behaves exactly as it does under ⌘X/⌘C/⌘V.
 */
export const TEXT_EDIT_COMMANDS = [
	'copy',
	'cut',
	'paste',
	'redo',
	'selectAll',
	'undo',
] as const;

/** One of the {@link TEXT_EDIT_COMMANDS}. */
export type TextEditCommand = (typeof TEXT_EDIT_COMMANDS)[number];
