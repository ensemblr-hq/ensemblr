import type { DatabaseSync } from 'node:sqlite';

import type { DictationSettings } from '../../shared/config';
import {
	MAX_DICTATION_AUDIO_BYTES,
	transcriptionTimeoutMs,
} from '../../shared/dictation-limits';
import type {
	DictationKeyMutationResult,
	DictationKeyStatus,
	TranscribeAudioRequest,
	TranscribeAudioResult,
} from '../../shared/ipc/contracts/dictation';
import type { SecretMetadata, SecretStore } from '../secrets/secret-store';
import {
	ALLOWED_ENDPOINT_PROTOCOLS,
	type CreateDictationServiceOptions,
	DICTATION_SECRET_KEY,
	DictationError,
	type DictationService,
} from './dictation-types.ts';

/** Longest slice of a provider's error body kept in a failure message. */
const MAX_PROVIDER_DETAIL_CHARS = 200;

/** Filename sent with the multipart upload; providers key format detection off its extension. */
const UPLOAD_FILE_NAME = 'dictation.webm';

/**
 * Maps a container MIME type to the filename extension providers expect. The
 * OpenAI transcription endpoint reads the format from the filename, not from the
 * part's content type, so a `.webm` name on Ogg bytes is rejected as corrupt.
 */
const EXTENSION_BY_MIME: Record<string, string> = {
	'audio/mp4': 'mp4',
	'audio/mpeg': 'mp3',
	'audio/ogg': 'ogg',
	'audio/wav': 'wav',
	'audio/webm': 'webm',
};

/**
 * Derives the upload filename from the recorder's MIME type, falling back to
 * webm — what Chromium's `MediaRecorder` produces by default.
 * @param mimeType - Container MIME type, possibly carrying codec parameters
 * @returns A filename whose extension matches the container
 */
function uploadFileName(mimeType: string): string {
	const baseType = mimeType.split(';')[0]?.trim().toLowerCase() ?? '';
	const extension = EXTENSION_BY_MIME[baseType];
	return extension ? `dictation.${extension}` : UPLOAD_FILE_NAME;
}

/**
 * Joins a configured API root with the transcription path, tolerating a
 * trailing slash so a hand-edited `config.json` cannot produce a double slash.
 *
 * The root is parsed rather than concatenated blindly: this request carries the
 * user's provider key in an `Authorization` header, so a value that is not an
 * absolute `http(s)` URL is refused here instead of reaching `fetch` and being
 * reported as an unreachable network.
 * @param baseUrl - OpenAI-compatible API root, e.g. `https://api.openai.com/v1`
 * @returns The absolute transcription endpoint
 */
function transcriptionEndpoint(baseUrl: string): string {
	const trimmed = baseUrl.trim().replace(/\/+$/, '');
	const parsed = URL.parse(trimmed);

	if (!parsed || !ALLOWED_ENDPOINT_PROTOCOLS.includes(parsed.protocol)) {
		throw new DictationError(
			'dictation-invalid-endpoint',
			'The transcription endpoint must be an absolute http:// or https:// URL.',
		);
	}

	return `${trimmed}/audio/transcriptions`;
}

/**
 * Strips a secret out of text bound for a failure message. Some providers echo
 * the submitted credential back in their error body, and that message is shown
 * in the UI and written into the support bundle.
 * @param text - Text about to be surfaced
 * @param secret - Value that must not appear in it
 * @returns The text with every occurrence of the secret replaced
 */
function redactSecret(text: string, secret: string): string {
	return secret ? text.split(secret).join('[redacted]') : text;
}

/**
 * Turns a provider's HTTP status into the failure the renderer translates.
 * @param status - HTTP status code from the transcription endpoint
 * @param detail - Trimmed response body, used as the English message
 * @returns The error to throw for this response
 */
function providerError(status: number, detail: string): DictationError {
	const message = detail
		? `Transcription failed (HTTP ${status}): ${detail}`
		: `Transcription failed (HTTP ${status}).`;

	if (status === 401 || status === 403) {
		return new DictationError('dictation-unauthorized', message);
	}
	if (status === 413) {
		return new DictationError('dictation-too-large', message);
	}
	if (status === 429) {
		return new DictationError('dictation-rate-limited', message);
	}
	return new DictationError('dictation-provider-error', message);
}

/**
 * Classifies a thrown `fetch` rejection. An abort is only ever raised here by
 * the request timeout, since the service owns the signal.
 * @param error - Whatever `fetch` rejected with
 * @returns The error to surface to the renderer
 */
function requestError(error: unknown): DictationError {
	if (error instanceof DictationError) {
		return error;
	}
	const name = error instanceof Error ? error.name : '';
	if (name === 'TimeoutError' || name === 'AbortError') {
		return new DictationError(
			'dictation-timeout',
			'The transcription request timed out.',
		);
	}
	return new DictationError(
		'dictation-network',
		'Could not reach the transcription provider.',
	);
}

/**
 * Reads the transcript out of a provider response, accepting both the plain
 * `{ text }` body and the verbose form that wraps it alongside segment data.
 * @param body - Parsed JSON response body
 * @returns The transcript, or null when the body carries none
 */
function readTranscript(body: unknown): string | null {
	if (typeof body !== 'object' || body === null) {
		return null;
	}
	const text = (body as { text?: unknown }).text;
	return typeof text === 'string' ? text : null;
}

/**
 * Builds the dictation service backing the composer's mic control: it owns the
 * API key in the platform secret store and posts recorded clips to an
 * OpenAI-compatible transcription endpoint.
 *
 * Nothing here throws across the IPC boundary — every path resolves to the
 * typed `{ status }` envelope the renderer's failure-text mapper understands.
 * @param options - Service dependencies (settings, database, secrets, fetch)
 * @returns A fresh {@link DictationService}
 */
export function createDictationService({
	databaseFactory,
	fetchImpl = fetch,
	readSettings,
	secretStoreFactory,
	timeoutMs,
}: CreateDictationServiceOptions): DictationService {
	/**
	 * Resolve the platform secret store, throwing when no backend is available.
	 * @returns The secret store holding app-scoped secrets
	 */
	function getSecretStore(): SecretStore {
		const database: DatabaseSync | null = databaseFactory();
		const store = database ? secretStoreFactory(database) : null;

		if (!store) {
			throw new DictationError(
				'dictation-key-store-unavailable',
				'No secret store backend is available on this platform.',
			);
		}

		return store;
	}

	/**
	 * Find the stored dictation key's non-secret metadata.
	 * @param store - Secret store to search
	 * @returns The entry's metadata, or null when no key is on file
	 */
	async function findKeyMetadata(
		store: SecretStore,
	): Promise<SecretMetadata | null> {
		const entries = await store.listMetadata({ scope: 'app' });
		return entries.find((entry) => entry.key === DICTATION_SECRET_KEY) ?? null;
	}

	/**
	 * Resolve the dictation settings, refusing to run while the feature is off or
	 * missing an endpoint.
	 * @returns The validated dictation settings
	 */
	function getEnabledSettings(): DictationSettings {
		const settings = readSettings().dictation;

		if (!settings.enabled) {
			throw new DictationError(
				'dictation-disabled',
				'Dictation is turned off in Settings.',
			);
		}
		if (!settings.baseUrl.trim() || !settings.model.trim()) {
			throw new DictationError(
				'dictation-not-configured',
				'Dictation has no transcription endpoint or model configured.',
			);
		}

		return settings;
	}

	/**
	 * Read the API key, refusing to run when the user has not supplied one.
	 * @returns The stored API key
	 */
	async function getApiKey(): Promise<string> {
		const value = await getSecretStore().read({
			key: DICTATION_SECRET_KEY,
			scope: 'app',
		});

		if (!value) {
			throw new DictationError(
				'dictation-no-api-key',
				'No transcription API key is stored.',
			);
		}

		return value;
	}

	/**
	 * Post one clip to the configured endpoint and read the transcript back.
	 * @param request - The recorded clip and its container type
	 * @returns The transcript, trimmed
	 */
	async function requestTranscript({
		audio,
		durationMs,
		mimeType,
	}: TranscribeAudioRequest): Promise<string> {
		const settings = getEnabledSettings();
		const endpoint = transcriptionEndpoint(settings.baseUrl);
		const apiKey = await getApiKey();

		const form = new FormData();
		form.append(
			'file',
			new File([audio as BlobPart], uploadFileName(mimeType), {
				type: mimeType,
			}),
		);
		form.append('model', settings.model);
		form.append('language', settings.language);
		form.append('response_format', 'json');

		const response = await fetchImpl(endpoint, {
			body: form,
			headers: { Authorization: `Bearer ${apiKey}` },
			method: 'POST',
			signal: AbortSignal.timeout(
				timeoutMs ?? transcriptionTimeoutMs(durationMs),
			),
		});

		if (!response.ok) {
			const body = (await response.text().catch(() => '')).trim();
			throw providerError(
				response.status,
				redactSecret(body, apiKey).slice(0, MAX_PROVIDER_DETAIL_CHARS),
			);
		}

		const transcript = readTranscript(await response.json().catch(() => null));

		if (transcript === null) {
			throw new DictationError(
				'dictation-provider-error',
				'The transcription provider returned an unreadable response.',
			);
		}

		return transcript.trim();
	}

	/**
	 * Project a stored secret's metadata into the renderer-safe key status.
	 * @param metadata - The stored entry, or null when no key is on file
	 * @returns What the settings screen shows about the stored key
	 */
	function toKeyStatus(metadata: SecretMetadata | null): DictationKeyStatus {
		return {
			configured: metadata !== null,
			failure: null,
			maskedKey: metadata?.maskedDisplay ?? null,
			updatedAt: metadata?.updatedAt ?? null,
		};
	}

	/**
	 * Convert a thrown error into the failure envelope IPC callers receive.
	 * @param error - Whatever the operation threw
	 * @returns The typed failure envelope
	 */
	function toFailure(error: unknown): {
		failure: { code: DictationError['code']; message: string };
		status: 'error';
	} {
		const dictationError =
			error instanceof DictationError ? error : requestError(error);
		return {
			failure: {
				code: dictationError.code,
				message: dictationError.message,
			},
			status: 'error',
		};
	}

	return {
		async clearApiKey(): Promise<DictationKeyMutationResult> {
			try {
				const store = getSecretStore();
				if (await findKeyMetadata(store)) {
					await store.delete({ key: DICTATION_SECRET_KEY, scope: 'app' });
				}
				return { keyStatus: toKeyStatus(null), status: 'ok' };
			} catch (error) {
				return toFailure(error);
			}
		},

		async getKeyStatus(): Promise<DictationKeyStatus> {
			try {
				return toKeyStatus(await findKeyMetadata(getSecretStore()));
			} catch (error) {
				const { failure } = toFailure(error);
				console.error('[dictation] could not read the stored key', error);
				return { ...toKeyStatus(null), failure };
			}
		},

		async setApiKey(value: string): Promise<DictationKeyMutationResult> {
			try {
				const trimmed = value.trim();

				if (!trimmed) {
					throw new DictationError(
						'dictation-no-api-key',
						'The transcription API key cannot be empty.',
					);
				}

				const store = getSecretStore();
				const input = {
					displayName: 'Dictation API key',
					key: DICTATION_SECRET_KEY,
					scope: 'app' as const,
					value: trimmed,
				};
				const metadata = (await findKeyMetadata(store))
					? await store.update(input)
					: await store.create(input);

				return { keyStatus: toKeyStatus(metadata), status: 'ok' };
			} catch (error) {
				return toFailure(error);
			}
		},

		async transcribe(
			request: TranscribeAudioRequest,
		): Promise<TranscribeAudioResult> {
			try {
				if (request.audio.byteLength === 0) {
					throw new DictationError(
						'dictation-empty-transcript',
						'The recording was empty.',
					);
				}
				if (request.audio.byteLength > MAX_DICTATION_AUDIO_BYTES) {
					throw new DictationError(
						'dictation-too-large',
						'The recording is too long to transcribe in one request.',
					);
				}

				const text = await requestTranscript(request);

				if (!text) {
					throw new DictationError(
						'dictation-empty-transcript',
						'No speech was detected in the recording.',
					);
				}

				return { status: 'ok', text };
			} catch (error) {
				return toFailure(error);
			}
		},
	};
}
