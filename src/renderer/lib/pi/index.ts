/**
 * Public runtime surface of `lib/pi`. Importers outside this folder should
 * reach for `@/renderer/lib/pi` rather than the leaf modules so the internal
 * split between dispatcher and concern-specific event mappers can evolve
 * without rippling through call sites.
 *
 * Per renderer convention this barrel re-exports runtime values only; shared
 * exported renderer types belong under `@/renderer/types/`.
 */

export { customMessageDataOf } from './custom-message-part';
export {
	eventsToUIMessages,
	noticeMetadataOf,
	turnMetadataOf,
} from './event-to-ui-message';
export { attachmentPathFromInlineCode } from './inline-attachment';
export {
	chipLabelForPath,
	parsePromptAttachments,
} from './prompt-attachment-parser';
export { skillInvocationKey } from './skill-invocation';
export { skillPartDataOf } from './skill-part';
export { parseToolDiagnostics } from './tool-diagnostics';
export {
	classifyToolOutput,
	looksLikeStackTrace,
} from './tool-output-classifier';
export {
	glyphForToolCall,
	presentCustomMessage,
	presentReasoning,
	presentSkillInvocation,
	presentToolCall,
} from './tool-presentation';
export {
	createWorkspacePathResolver,
	toWorkspaceLookupPath,
} from './workspace-path';
