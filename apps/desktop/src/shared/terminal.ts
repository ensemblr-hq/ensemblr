/**
 * Public entrypoint for pure terminal-stream helpers shared by the main process
 * and the renderer. Import from here rather than the `terminal/` implementation
 * files.
 */
export {
	detectPreviewUrl,
	extractPreviewPort,
} from './terminal/detect-preview-url.ts';
export {
	isHarnessTitleBusy,
	stripHarnessTitleDecoration,
} from './terminal/harness-title.ts';
export {
	scrollbackMbToBytes,
	scrollbackMbToLines,
} from './terminal/scrollback.ts';
export { stripReportRequests } from './terminal/strip-report-requests.ts';
