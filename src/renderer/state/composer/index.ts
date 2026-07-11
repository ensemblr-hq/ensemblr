/**
 * Public surface for the renderer-wide composer concern: composer-insert,
 * composer-submit, and attachment cross-component channels, the Pi composer
 * controller hook, and the optimistic prompt store shared between the composer
 * and the timeline.
 *
 * Outside this folder, import from `@/renderer/state/composer` only.
 */

export {
	useComposerAttachmentDispatcher,
	useComposerAttachmentInbox,
} from './composer-attachments';
export {
	composerExternalsAtomFamily,
	composerMentionsAtomFamily,
	composerUploadsAtomFamily,
	composerValueAtomFamily,
	forgetComposerDraft,
} from './composer-drafts';
export type { ComposerInsertRequest } from './composer-insert';
export {
	useComposerInsert,
	useComposerInsertConsumer,
} from './composer-insert';
export type { ComposerSubmitRequest } from './composer-submit';
export {
	useComposerSubmit,
	useComposerSubmitConsumer,
} from './composer-submit';
export type { OptimisticPrompt } from './optimistic-prompts';
export { useOptimisticPrompts } from './optimistic-prompts';
export type { PiComposerControllerState } from './pi-composer';
export { usePiComposerController } from './pi-composer';
export { useStopPiSession } from './use-stop-pi-session';
