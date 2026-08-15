import type { DatabaseSync } from 'node:sqlite';

import type { AppSettings } from '../../shared/config';
import type {
	DictationFailureCode,
	DictationKeyMutationResult,
	DictationKeyStatus,
	TranscribeAudioRequest,
	TranscribeAudioResult,
} from '../../shared/ipc/contracts/dictation';
import type { SecretStore } from '../secrets/secret-store';

/**
 * Scope and key the dictation API key is filed under in the macOS Keychain. App
 * scope because one key serves every workspace.
 */
export const DICTATION_SECRET_KEY = 'dictation:api-key';

/** URL schemes a transcription endpoint may use. Plain `http:` stays allowed
 * because a locally-run `whisper-server` is a supported target. */
export const ALLOWED_ENDPOINT_PROTOCOLS: readonly string[] = [
	'http:',
	'https:',
];

/** Thrown inside the service and converted to a typed failure at its edge. */
export class DictationError extends Error {
	readonly code: DictationFailureCode;

	/**
	 * @param code - Machine-readable failure category the renderer translates
	 * @param message - English sentence kept for the support bundle
	 */
	constructor(code: DictationFailureCode, message: string) {
		super(message);
		this.name = 'DictationError';
		this.code = code;
	}
}

/** Transcription and API-key operations backing the composer's mic control. */
export interface DictationService {
	clearApiKey: () => Promise<DictationKeyMutationResult>;
	getKeyStatus: () => Promise<DictationKeyStatus>;
	setApiKey: (value: string) => Promise<DictationKeyMutationResult>;
	transcribe: (
		request: TranscribeAudioRequest,
	) => Promise<TranscribeAudioResult>;
}

/**
 * Options for {@link import('./dictation-service.ts').createDictationService}.
 * `timeoutMs` pins the request deadline that is otherwise scaled to clip length,
 * so a test does not have to wait one out.
 */
export interface CreateDictationServiceOptions {
	databaseFactory: () => DatabaseSync | null;
	fetchImpl?: typeof fetch;
	readSettings: () => AppSettings;
	secretStoreFactory: (database: DatabaseSync) => SecretStore | null;
	timeoutMs?: number;
}
