/**
 * Public runtime surface of `lib/pi`. Importers outside this folder should
 * reach for `@/renderer/lib/pi` rather than the leaf modules so the internal
 * split between dispatcher and concern-specific event mappers can evolve
 * without rippling through call sites.
 *
 * Per renderer convention this barrel re-exports runtime values only; shared
 * exported renderer types belong under `@/renderer/types/`.
 */

export { eventsToUIMessages } from './event-to-ui-message';
export {
	classifyToolOutput,
	looksLikeStackTrace,
} from './tool-output-classifier';
