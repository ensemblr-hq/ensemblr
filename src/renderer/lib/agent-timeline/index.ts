/**
 * Public runtime surface of `lib/agent-timeline`, the provider-neutral layer
 * that turns persisted `AgentPersistedEnvelope` events into the `UIMessage`
 * shape the live conversation panel renders. Every agent runtime — Pi, Claude
 * Code, anything added later — feeds this same surface.
 *
 * Importers outside this folder should reach for `@/renderer/lib/agent-timeline`
 * rather than the leaf modules so the internal split between dispatcher and
 * concern-specific mappers can evolve without rippling through call sites.
 *
 * Per renderer convention this barrel re-exports runtime values only; shared
 * exported renderer types belong under `@/renderer/types/`.
 */

export { isHiddenEnsemblrToolCall } from './ensemblr-tool-presentation.ts';
export {
	createTimelineProjector,
	eventsToUIMessages,
	noticeMetadataOf,
	turnMetadataOf,
} from './event-to-ui-message.ts';
export { attachmentPathFromInlineCode } from './inline-attachment.ts';
export { formatModelDisplayName } from './model-display-name.ts';
export {
	filterUnmatchedOptimistic,
	matchOptimisticAgainstMessages,
	optimisticToUIMessage,
} from './optimistic-prompts.ts';
export {
	chipLabelForPath,
	parsePromptAttachments,
} from './prompt-attachment-parser.ts';
export {
	countNestedToolCalls,
	dropEchoedSubagentReports,
	groupSubagentActivity,
	parentToolCallIdOf,
} from './subagent-parts.ts';
export { parseToolDiagnostics } from './tool-diagnostics.ts';
export {
	classifyToolOutput,
	looksLikeStackTrace,
} from './tool-output-classifier.ts';
export {
	glyphForToolCall,
	presentCustomMessage,
	presentReasoning,
	presentSkillInvocation,
	presentToolCall,
} from './tool-presentation.ts';
export { glyphForToolName } from './tool-presenters.ts';
export {
	createWorkspacePathResolver,
	toWorkspaceLookupPath,
} from './workspace-path.ts';
