/**
 * Public surface for the renderer-wide composer concern: composer-insert,
 * composer-submit, and attachment cross-component channels, the agent composer
 * controller hook, and the optimistic prompt store shared between the composer
 * and the timeline.
 *
 * Outside this folder, import from `@/renderer/state/composer` only.
 */

export type { AgentComposerControllerState } from './agent-composer';
export { useAgentComposerController } from './agent-composer';
export type { ComposerAttachmentTarget } from './composer-attachments';
export {
	useComposerAttachmentDispatcher,
	useComposerAttachmentInbox,
	useComposerAttachmentInsert,
} from './composer-attachments';
export {
	composerAttachmentsAtomFamily,
	composerEditorStateAtomFamily,
	composerLinkedIssueSeededAtomFamily,
	composerValueAtomFamily,
	forgetComposerDraft,
} from './composer-drafts';
export {
	useConsumeComposerFocusRequest,
	useRequestComposerFocus,
} from './composer-focus';
export type { ComposerInsertRequest } from './composer-insert';
export {
	useComposerInsert,
	useComposerInsertConsumer,
	useComposerInsertToChat,
} from './composer-insert';
export type { ComposerSubmitRequest } from './composer-submit';
export {
	useComposerSubmit,
	useComposerSubmitConsumer,
	useDropComposerSubmits,
} from './composer-submit';
export type { FollowUpQueueApi } from './follow-up-queue';
export {
	appendFollowUp,
	createFollowUp,
	followUpQueueAtomFamily,
	followUpQueueHoldReasonAtomFamily,
	forgetFollowUpQueue,
	moveFollowUp,
	removeFollowUp,
	reorderFollowUps,
	useDropFollowUpQueue,
	useFollowUpQueue,
} from './follow-up-queue';
export type { OptimisticPrompt } from './optimistic-prompts';
export {
	useHasPendingPrompts,
	useOptimisticPrompts,
} from './optimistic-prompts';
export type { PrimedAction } from './primed-action';
export {
	primedActionAtomFamily,
	useComposerPrimedActionConsumer,
} from './primed-action';
export { useStopAgentSession } from './use-stop-agent-session';
