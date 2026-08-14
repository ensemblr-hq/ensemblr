/**
 * Machine-readable failure categories surfaced by composer dictation. The
 * capture failures (`dictation-microphone-*`, `dictation-recorder-unavailable`)
 * originate in the renderer rather than in main, but they share this union so
 * every dictation failure reaches the user through one text table.
 */
export type DictationFailureCode =
	| 'dictation-disabled'
	| 'dictation-empty-transcript'
	| 'dictation-invalid-endpoint'
	| 'dictation-key-store-unavailable'
	| 'dictation-microphone-denied'
	| 'dictation-microphone-missing'
	| 'dictation-network'
	| 'dictation-no-api-key'
	| 'dictation-not-configured'
	| 'dictation-provider-error'
	| 'dictation-rate-limited'
	| 'dictation-recorder-unavailable'
	| 'dictation-timeout'
	| 'dictation-too-large'
	| 'dictation-unauthorized';

/** Typed failure envelope returned by dictation IPC calls. */
export interface DictationFailure {
	code: DictationFailureCode;
	message: string;
}

/** One recorded clip handed to the transcription provider. */
export interface TranscribeAudioRequest {
	/** Raw container bytes as produced by the renderer's `MediaRecorder`. */
	audio: Uint8Array;
	/**
	 * How long the clip runs, as the recorder measured it. The request deadline
	 * scales off this, since a slow endpoint needs longer for a longer clip.
	 */
	durationMs: number;
	/** Container MIME type, e.g. `audio/webm;codecs=opus`. */
	mimeType: string;
}

/** Outcome of transcribing one recorded clip. */
export type TranscribeAudioResult =
	| { status: 'ok'; text: string }
	| { failure: DictationFailure; status: 'error' };

/**
 * Whether an API key is on file, without ever moving the key itself into the
 * renderer. `maskedKey` is the store's own redaction, shown so the user can tell
 * two keys apart. `failure` is set when the store could not be read at all,
 * which is not the same answer as "no key stored" and must not be shown as one.
 */
export interface DictationKeyStatus {
	configured: boolean;
	failure: DictationFailure | null;
	maskedKey: string | null;
	updatedAt: string | null;
}

/** Outcome of writing or clearing the dictation API key. */
export type DictationKeyMutationResult =
	| { status: 'ok'; keyStatus: DictationKeyStatus }
	| { failure: DictationFailure; status: 'error' };

/** Preload bridge surface for composer dictation. */
export interface DictationApi {
	clearDictationApiKey: () => Promise<DictationKeyMutationResult>;
	dictationKeyStatus: () => Promise<DictationKeyStatus>;
	setDictationApiKey: (request: {
		value: string;
	}) => Promise<DictationKeyMutationResult>;
	transcribeAudio: (
		request: TranscribeAudioRequest,
	) => Promise<TranscribeAudioResult>;
}
