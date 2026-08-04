/**
 * Public surface for the app's code surfaces: the chat-density scroll shell and
 * panel, the line and gutter primitives every surface shares, the skipped-lines
 * band, the panel header, and the class recipes that keep all of them in step.
 */
export { CodeGutter, CodeLineTokens } from './code-lines';
export { CodePanel } from './code-panel';
export {
	CODE_CHAT_TEXT_CLASSES,
	CODE_CONTENT_CLASSES,
	CODE_GUTTER_CLASSES,
	CODE_GUTTER_DIVIDER_CLASSES,
	CODE_PANEL_TEXT_CLASSES,
	CODE_SURFACE_CLASSES,
	DIFF_GUTTER_TINT,
	DIFF_ROW_SURFACE,
} from './code-style';
export { CodeSurface } from './code-surface';
export { CodeHunkGap } from './hunk-gap';
export { CodeViewerHeader } from './viewer-header';
