/**
 * Public surface for the renderer-wide composer concern: composer-insert and
 * attachment cross-component channels, the Pi composer controller hook, and
 * the optimistic prompt store shared between the composer and the timeline.
 *
 * Outside this folder, import from `@/renderer/state/composer` only.
 */

export {
	useComposerAttachmentDispatcher,
	useComposerAttachmentInbox,
} from './composer-attachments';
export type { ComposerInsertRequest } from './composer-insert';
export {
	useComposerInsert,
	useComposerInsertConsumer,
} from './composer-insert';
export type { OptimisticPrompt } from './optimistic-prompts';
export { useOptimisticPrompts } from './optimistic-prompts';
export type { PiComposerControllerState } from './pi-composer';
export { usePiComposerController } from './pi-composer';
export { useStopPiSession } from './use-stop-pi-session';
