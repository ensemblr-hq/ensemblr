import type { TFunction } from 'i18next';

import type { CodedFailure } from '@/renderer/lib/failure-text';

/**
 * Wraps a rejected publication call as a coded failure the panel can render
 * beside the backend's own. The IPC layer rejects only when the call never
 * reached a handler, so there is no code from main to translate — the sentence
 * is authored here, and `failureText` falls back to it because no table entry
 * claims this code.
 * @param t - Translator bound to the active language.
 * @returns A failure carrying an already-translated message.
 */
export function unexpectedPublicationFailure(t: TFunction): CodedFailure {
	return {
		code: 'publication-call-failed',
		message: t(
			'settings:repo.publication.unexpected',
			'Ensemblr could not complete the request. Nothing was changed — try again.',
		),
	};
}
