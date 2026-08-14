import type { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { createDictationService } from '../../src/main/dictation/dictation-service.ts';
import { DICTATION_SECRET_KEY } from '../../src/main/dictation/dictation-types.ts';
import type {
	SecretMetadata,
	SecretStore,
} from '../../src/main/secrets/secret-store.ts';
import { DEFAULT_APP_SETTINGS } from '../../src/shared/config.ts';
import {
	MAX_DICTATION_CLIP_MS,
	transcriptionTimeoutMs,
} from '../../src/shared/dictation-limits.ts';

const API_KEY = 'sk-test-abcdefghijklmnop';

/** Settings with dictation switched on, as the service requires to run at all. */
const enabledSettings = () => ({
	...DEFAULT_APP_SETTINGS,
	dictation: {
		...DEFAULT_APP_SETTINGS.dictation,
		baseUrl: 'https://api.example.test/v1',
		enabled: true,
		model: 'test-transcribe',
	},
});

/** Metadata row the store reports for a key that is on file. */
const keyMetadata = (): SecretMetadata =>
	({
		key: DICTATION_SECRET_KEY,
		maskedDisplay: '****mnop',
		scope: 'app',
		updatedAt: '2026-08-14T00:00:00.000Z',
	}) as SecretMetadata;

/**
 * In-memory secret store standing in for the Keychain backend.
 * @param stored - Key value already on file, or null when none is stored
 */
function fakeSecretStore(stored: string | null): SecretStore {
	let value = stored;
	return {
		create: vi.fn(async (input) => {
			value = input.value;
			return keyMetadata();
		}),
		delete: vi.fn(async () => {
			value = null;
		}),
		listMetadata: vi.fn(async () => (value === null ? [] : [keyMetadata()])),
		maskSecret: (secret: string) => `****${secret.slice(-4)}`,
		read: vi.fn(async () => value),
		update: vi.fn(async (input) => {
			value = input.value;
			return keyMetadata();
		}),
	} as unknown as SecretStore;
}

/** Builds a service over a stubbed fetch, secret store, and settings reader. */
function buildService({
	fetchImpl,
	settings = enabledSettings(),
	stored = API_KEY,
}: {
	fetchImpl?: typeof fetch;
	settings?: ReturnType<typeof enabledSettings>;
	stored?: string | null;
} = {}) {
	const store = fakeSecretStore(stored);
	const service = createDictationService({
		databaseFactory: () => ({}) as DatabaseSync,
		fetchImpl: fetchImpl ?? vi.fn(),
		readSettings: () => settings,
		secretStoreFactory: () => store,
	});
	return { service, store };
}

/** A JSON response with the given status and body, as `fetch` would return it. */
const jsonResponse = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), {
		headers: { 'content-type': 'application/json' },
		status,
	});

const clip = {
	audio: new Uint8Array([1, 2, 3]),
	durationMs: 4_000,
	mimeType: 'audio/webm',
};

let fetchImpl: ReturnType<typeof vi.fn>;

beforeEach(() => {
	fetchImpl = vi.fn(async () => jsonResponse({ text: 'fix the parser' }));
});

describe('transcribe', () => {
	test('posts the clip and returns the transcript', async () => {
		const { service } = buildService({
			fetchImpl: fetchImpl as unknown as typeof fetch,
		});

		const result = await service.transcribe(clip);

		expect(result).toEqual({ status: 'ok', text: 'fix the parser' });

		const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
		expect(url).toBe('https://api.example.test/v1/audio/transcriptions');
		expect((init.headers as Record<string, string>).Authorization).toBe(
			`Bearer ${API_KEY}`,
		);

		const form = init.body as FormData;
		expect(form.get('model')).toBe('test-transcribe');
		expect(form.get('language')).toBe('en');
		expect((form.get('file') as File).name).toBe('dictation.webm');
	});

	test('trims a trailing slash off the configured endpoint', async () => {
		const settings = enabledSettings();
		settings.dictation.baseUrl = 'https://api.example.test/v1/';
		const { service } = buildService({
			fetchImpl: fetchImpl as unknown as typeof fetch,
			settings,
		});

		await service.transcribe(clip);

		expect(fetchImpl.mock.calls[0]?.[0]).toBe(
			'https://api.example.test/v1/audio/transcriptions',
		);
	});

	test.each([
		['not-a-url/v1', 'a value that is not a URL'],
		['api.example.test/v1', 'a host with no scheme'],
		['file:///tmp/whisper', 'a scheme fetch cannot post to'],
	])('refuses %s (%s) before sending the key', async (baseUrl) => {
		const settings = enabledSettings();
		settings.dictation.baseUrl = baseUrl;
		const { service } = buildService({
			fetchImpl: fetchImpl as unknown as typeof fetch,
			settings,
		});

		const result = await service.transcribe(clip);

		expect(result).toMatchObject({
			failure: { code: 'dictation-invalid-endpoint' },
			status: 'error',
		});
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	test('allows a local http endpoint, which whisper-server serves on', async () => {
		const settings = enabledSettings();
		settings.dictation.baseUrl = 'http://127.0.0.1:8080/v1';
		const { service } = buildService({
			fetchImpl: fetchImpl as unknown as typeof fetch,
			settings,
		});

		await service.transcribe(clip);

		expect(fetchImpl.mock.calls[0]?.[0]).toBe(
			'http://127.0.0.1:8080/v1/audio/transcriptions',
		);
	});

	test('scales the request deadline to the length of the clip', async () => {
		const deadline = vi.spyOn(AbortSignal, 'timeout');
		const { service } = buildService({
			fetchImpl: fetchImpl as unknown as typeof fetch,
		});

		await service.transcribe(clip);
		await service.transcribe({ ...clip, durationMs: MAX_DICTATION_CLIP_MS });

		// A five-minute clip has to outlive the deadline a four-second one gets,
		// or the recorder produces audio the request throws away with no retry.
		expect(deadline).toHaveBeenNthCalledWith(1, transcriptionTimeoutMs(4_000));
		expect(deadline).toHaveBeenNthCalledWith(
			2,
			transcriptionTimeoutMs(MAX_DICTATION_CLIP_MS),
		);
		expect(deadline.mock.calls[1]?.[0]).toBeGreaterThan(MAX_DICTATION_CLIP_MS);

		deadline.mockRestore();
	});

	test('names the upload for the container it was recorded in', async () => {
		const { service } = buildService({
			fetchImpl: fetchImpl as unknown as typeof fetch,
		});

		await service.transcribe({ ...clip, mimeType: 'audio/mp4' });

		const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
		expect(((init.body as FormData).get('file') as File).name).toBe(
			'dictation.mp4',
		);
	});

	test('refuses to run while dictation is switched off', async () => {
		const { service } = buildService({
			fetchImpl: fetchImpl as unknown as typeof fetch,
			settings: DEFAULT_APP_SETTINGS as ReturnType<typeof enabledSettings>,
		});

		const result = await service.transcribe(clip);

		expect(result).toMatchObject({
			failure: { code: 'dictation-disabled' },
			status: 'error',
		});
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	test('refuses to run with no API key on file', async () => {
		const { service } = buildService({
			fetchImpl: fetchImpl as unknown as typeof fetch,
			stored: null,
		});

		const result = await service.transcribe(clip);

		expect(result).toMatchObject({
			failure: { code: 'dictation-no-api-key' },
			status: 'error',
		});
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	test('reports an empty recording without calling the provider', async () => {
		const { service } = buildService({
			fetchImpl: fetchImpl as unknown as typeof fetch,
		});

		const result = await service.transcribe({
			audio: new Uint8Array(),
			durationMs: 0,
			mimeType: 'audio/webm',
		});

		expect(result).toMatchObject({
			failure: { code: 'dictation-empty-transcript' },
			status: 'error',
		});
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	test('refuses a clip past the upload limit before sending it', async () => {
		const { service } = buildService({
			fetchImpl: fetchImpl as unknown as typeof fetch,
		});

		const result = await service.transcribe({
			audio: new Uint8Array(21 * 1024 * 1024),
			durationMs: 300_000,
			mimeType: 'audio/webm',
		});

		expect(result).toMatchObject({
			failure: { code: 'dictation-too-large' },
			status: 'error',
		});
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	test('reports a transcript with no speech in it', async () => {
		const { service } = buildService({
			fetchImpl: vi.fn(async () =>
				jsonResponse({ text: '   ' }),
			) as unknown as typeof fetch,
		});

		const result = await service.transcribe(clip);

		expect(result).toMatchObject({
			failure: { code: 'dictation-empty-transcript' },
			status: 'error',
		});
	});

	test.each([
		[401, 'dictation-unauthorized'],
		[403, 'dictation-unauthorized'],
		[413, 'dictation-too-large'],
		[429, 'dictation-rate-limited'],
		[500, 'dictation-provider-error'],
	])('maps HTTP %i onto %s', async (status, code) => {
		const { service } = buildService({
			fetchImpl: vi.fn(async () =>
				jsonResponse({ error: 'nope' }, status),
			) as unknown as typeof fetch,
		});

		const result = await service.transcribe(clip);

		expect(result).toMatchObject({ failure: { code }, status: 'error' });
	});

	test('reports an unreadable success body as a provider error', async () => {
		const { service } = buildService({
			fetchImpl: vi.fn(async () =>
				jsonResponse({ nothing: true }),
			) as unknown as typeof fetch,
		});

		const result = await service.transcribe(clip);

		expect(result).toMatchObject({
			failure: { code: 'dictation-provider-error' },
			status: 'error',
		});
	});

	test('reports a timeout distinctly from a network failure', async () => {
		const abortError = Object.assign(new Error('timed out'), {
			name: 'TimeoutError',
		});
		const { service } = buildService({
			fetchImpl: vi.fn(async () => {
				throw abortError;
			}) as unknown as typeof fetch,
		});

		const result = await service.transcribe(clip);

		expect(result).toMatchObject({
			failure: { code: 'dictation-timeout' },
			status: 'error',
		});
	});

	test('reports an unreachable provider as a network failure', async () => {
		const { service } = buildService({
			fetchImpl: vi.fn(async () => {
				throw new TypeError('fetch failed');
			}) as unknown as typeof fetch,
		});

		const result = await service.transcribe(clip);

		expect(result).toMatchObject({
			failure: { code: 'dictation-network' },
			status: 'error',
		});
	});

	test('never puts the API key in a failure message', async () => {
		const { service } = buildService({
			fetchImpl: vi.fn(async () =>
				jsonResponse({ error: `rejected key ${API_KEY}` }, 500),
			) as unknown as typeof fetch,
		});

		const result = await service.transcribe(clip);

		expect(result.status).toBe('error');
		expect(JSON.stringify(result)).not.toContain(API_KEY);
	});
});

describe('API key lifecycle', () => {
	test('creates a key when none is stored', async () => {
		const { service, store } = buildService({ stored: null });

		const result = await service.setApiKey(`  ${API_KEY}  `);

		expect(result).toMatchObject({ status: 'ok' });
		expect(store.create).toHaveBeenCalledWith(
			expect.objectContaining({ key: DICTATION_SECRET_KEY, value: API_KEY }),
		);
		expect(store.update).not.toHaveBeenCalled();
	});

	test('updates the key in place when one is already stored', async () => {
		const { service, store } = buildService();

		await service.setApiKey('sk-replacement-key');

		expect(store.update).toHaveBeenCalled();
		expect(store.create).not.toHaveBeenCalled();
	});

	test('rejects an all-whitespace key', async () => {
		const { service, store } = buildService({ stored: null });

		const result = await service.setApiKey('   ');

		expect(result).toMatchObject({
			failure: { code: 'dictation-no-api-key' },
			status: 'error',
		});
		expect(store.create).not.toHaveBeenCalled();
	});

	test('reports the masked key rather than the key itself', async () => {
		const { service } = buildService();

		const status = await service.getKeyStatus();

		expect(status).toEqual({
			configured: true,
			failure: null,
			maskedKey: '****mnop',
			updatedAt: '2026-08-14T00:00:00.000Z',
		});
		expect(JSON.stringify(status)).not.toContain(API_KEY);
	});

	test('reports an unreadable store as a failure, not as no key stored', async () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => {});
		const service = createDictationService({
			databaseFactory: () => null,
			readSettings: enabledSettings,
			secretStoreFactory: () => null,
		});

		const status = await service.getKeyStatus();

		// `configured: false` alone would hide the mic with nothing on screen
		// saying why, and read identically to a user who never added a key.
		expect(status.configured).toBe(false);
		expect(status.failure?.code).toBe('dictation-key-store-unavailable');
		expect(error).toHaveBeenCalled();

		error.mockRestore();
	});

	test('reports no key once it has been cleared', async () => {
		const { service, store } = buildService();

		const result = await service.clearApiKey();

		expect(store.delete).toHaveBeenCalled();
		expect(result).toEqual({
			keyStatus: {
				configured: false,
				failure: null,
				maskedKey: null,
				updatedAt: null,
			},
			status: 'ok',
		});
	});

	test('clearing is a no-op when nothing is stored', async () => {
		const { service, store } = buildService({ stored: null });

		const result = await service.clearApiKey();

		expect(store.delete).not.toHaveBeenCalled();
		expect(result).toMatchObject({ status: 'ok' });
	});
});
