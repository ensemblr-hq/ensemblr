import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
	type AgentClient,
	AgentClientError,
	type AgentSession,
} from '../../src/main/agent-runtime';
import {
	type ConciergeRuntimeSettings,
	createConciergeSessionService,
} from '../../src/main/concierge';
import { openEnsemblrDatabase } from '../../src/main/storage/database.ts';

const HOME = '/tmp/root/concierge';
const OPENED_ON = 'anthropic/claude-sonnet-5';
const SWITCHED_TO = 'anthropic/claude-opus-5';

let database: DatabaseSync;
let directory: string;

/**
 * A runtime child that accepts every prompt, or refuses each one the way the
 * client refuses a submit it could not deliver.
 * @param options - Whether this child refuses the prompts it is given.
 * @returns The runtime session.
 */
const fakeChild = (options: { refuseSubmit?: boolean }): AgentSession =>
	({
		abort: async () => undefined,
		close: async () => undefined,
		getMetadata: () => ({ sessionId: 'runtime-1' }) as never,
		getState: async () => ({}) as never,
		id: 'runtime-1' as never,
		refreshPlanUsage: async () => false,
		setSessionName: async () => undefined,
		subscribe: () => ({ unsubscribe: () => undefined }),
		submit: async () => {
			if (options.refuseSubmit) {
				throw new AgentClientError({
					code: 'submit-failed',
					message: 'The runtime refused the prompt.',
					recoverable: true,
				});
			}
			return { acceptedAt: '2026-08-24T00:00:00.000Z' } as never;
		},
	}) as AgentSession;

/**
 * The service over a real database, with the settings a test wants to vary.
 * @param options - Whether the runtime refuses submits, and any settings overrides.
 * @returns The service under test.
 */
const setup = (
	options: {
		refuseSubmit?: boolean;
		settings?: Partial<ConciergeRuntimeSettings>;
	} = {},
) => {
	const child = fakeChild({ refuseSubmit: options.refuseSubmit });
	const agentClient: AgentClient = {
		createSession: async () => child,
		listSessions: () => [],
		shutdown: async () => undefined,
	};
	const service = createConciergeSessionService({
		agentClient,
		requireDatabase: () => database,
		resolveHome: () => ({
			artifactsPath: path.join(HOME, 'artifacts'),
			memoryIndexPath: path.join(HOME, 'MEMORY.md'),
			memoryPath: path.join(HOME, 'memory'),
			rootPath: HOME,
		}),
		resolveReadableDirectories: () => [],
		resolveSettings: () => ({
			autoClearAtPercent: 0.8,
			model: OPENED_ON,
			provider: 'claude',
			thinkingLevel: 'medium',
			...options.settings,
		}),
	});
	return { service };
};

beforeEach(() => {
	directory = mkdtempSync(path.join(tmpdir(), 'ensemblr-concierge-choice-'));
	database = openEnsemblrDatabase({
		databasePath: path.join(directory, 'concierge.db'),
	}).database;
});

afterEach(() => {
	database.close();
	rmSync(directory, { force: true, recursive: true });
});

/**
 * What a spawn inherits from the Concierge, and therefore what has to track the
 * conversation rather than the moment it opened. `modelOverride` rides one
 * request and is gone, so the session row is the only thing a later reader has.
 */
describe('the runtime choice the Concierge reports for a child to inherit', () => {
	it('reports nothing at all before a session is attached', () => {
		const { service } = setup();

		expect(service.describeActiveSession()).toBeNull();
	});

	it('reports what the session opened on before any turn names another', async () => {
		const { service } = setup();
		await service.openSession({ fresh: true });

		expect(service.describeActiveSession()).toEqual({
			model: OPENED_ON,
			thinkingLevel: 'medium',
		});
	});

	// The bug this closes: the user's pick in the Concierge composer reached the
	// runtime as a per-request override and nowhere else, so a child spawned
	// afterwards inherited the model its parent had left turns ago.
	it('follows the model a turn switched to', async () => {
		const { service } = setup();
		const opened = await service.openSession({ fresh: true });

		await service.submitPrompt({
			model: SWITCHED_TO,
			prompt: 'take another look',
			sessionId: opened.session?.id ?? '',
			thinkingLevel: 'high',
		});

		expect(service.describeActiveSession()).toEqual({
			model: SWITCHED_TO,
			thinkingLevel: 'high',
		});
	});

	it('keeps the previous choice when a turn names none', async () => {
		const { service } = setup();
		const opened = await service.openSession({ fresh: true });
		await service.submitPrompt({
			model: SWITCHED_TO,
			prompt: 'take another look',
			sessionId: opened.session?.id ?? '',
		});

		await service.submitPrompt({
			prompt: 'and again',
			sessionId: opened.session?.id ?? '',
		});

		expect(service.describeActiveSession()?.model).toBe(SWITCHED_TO);
	});

	// A choice the runtime never accepted is not what the conversation is on.
	it('records nothing for a turn the runtime refused', async () => {
		const { service } = setup({ refuseSubmit: true });
		const opened = await service.openSession({ fresh: true });

		const result = await service.submitPrompt({
			model: SWITCHED_TO,
			prompt: 'take another look',
			sessionId: opened.session?.id ?? '',
		});

		expect(result.error).toBeDefined();
		expect(service.describeActiveSession()?.model).toBe(OPENED_ON);
	});

	// The row stores null for "whatever the setting says", so a Concierge that
	// has never been given a model reports the setting — which is null too, and
	// is what makes the spawn path refuse rather than pick a default nobody chose.
	it('falls through to the settings, nulls included, when the row names none', async () => {
		const { service } = setup({
			settings: { model: null, thinkingLevel: null },
		});
		await service.openSession({ fresh: true });

		expect(service.describeActiveSession()).toEqual({
			model: null,
			thinkingLevel: null,
		});
	});
});
