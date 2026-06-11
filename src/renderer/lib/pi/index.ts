/**
 * Public runtime surface of `lib/pi`. Importers outside this folder should
 * reach for `@/renderer/lib/pi` rather than the leaf modules so the internal
 * split between dispatcher and concern-specific event mappers can evolve
 * without rippling through call sites.
 *
 * Per renderer convention this barrel re-exports runtime values only; shared
 * exported renderer types belong under `@/renderer/types/`.
 */

export type { PiTurnMetadata } from './event-to-ui-message';
export { eventsToUIMessages, turnMetadataOf } from './event-to-ui-message';
export type {
	ParsedPrompt,
	ParsedPromptAttachment,
} from './prompt-attachment-parser';
export {
	chipLabelForPath,
	parsePromptAttachments,
} from './prompt-attachment-parser';
export {
	classifyToolOutput,
	looksLikeStackTrace,
	looksLikeStructuredDump,
} from './tool-output-classifier';
export type { ToolRowProjection } from './tool-row-projector';
export { projectToolRow } from './tool-row-projector';
export { toWorkspaceRelativePath } from './workspace-path';
