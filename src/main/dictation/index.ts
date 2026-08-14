/**
 * Public entry point for the dictation concern: the service backing the
 * composer's mic control, plus the error type and endpoint policy its callers
 * need. The clip limits both processes share live in
 * {@link import('../../shared/dictation-limits')}.
 */
export { createDictationService } from './dictation-service.ts';
export {
	ALLOWED_ENDPOINT_PROTOCOLS,
	type CreateDictationServiceOptions,
	DICTATION_SECRET_KEY,
	DictationError,
	type DictationService,
} from './dictation-types.ts';
