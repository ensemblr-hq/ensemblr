import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
	AgentClient,
	AgentSession,
	AgentSessionRequest,
} from '../../src/main/agent-runtime';
import { createConciergeSessionService } from '../../src/main/concierge';
import { openEnsemblrDatabase } from '../../src/main/storage/database.ts';

const HOME = '/tmp/root/concierge';
const CONTROL_MCP = { token: 'tok-concierge', url: 'http://127.0.0.1:4321' };

let database: DatabaseSync;
let directory: string;

/**
 * A runtime session that records nothing and answers everything, so the test
 * observes only what the service asked the client to open.
 */
const fakeSession = (): AgentSession =>
	({
		abort: async () => undefined,
		close: async () => undefined,
		getMetadata: () => ({ sessionId: 'runtime-1' }) as never,
		getState: async () => ({}) as never,
		id: 'runtime-1' as never,
		refreshPlanUsage: async () => false,
		setSessionName: async () => undefined,
		subscribe: () => ({ unsubscribe: () => undefined }),
		submit: async () => ({ acceptedAt: '2026-08-24T00:00:00.000Z' }) as never,
	}) as AgentSession;

/**
 * Builds the service over a real database with a client that captures the one
 * request it is handed.
 */
const setup = (
	options: {
		releaseControlOrigin?: (sessionId: string) => void;
		wiring?: Parameters<
			typeof createConciergeSessionService
		>[0]['resolveControlWiring'];
	} = {},
) => {
	const requests: AgentSessionRequest[] = [];
	const agentClient: AgentClient = {
		createSession: async (request) => {
			requests.push(request);
			return fakeSession();
		},
		listSessions: () => [],
		shutdown: async () => undefined,
	};
	const service = createConciergeSessionService({
		agentClient,
		releaseControlOrigin: options.releaseControlOrigin,
		requireDatabase: () => database,
		resolveControlWiring: options.wiring,
		resolveHome: () => ({
			artifactsPath: path.join(HOME, 'artifacts'),
			memoryIndexPath: path.join(HOME, 'MEMORY.md'),
			memoryPath: path.join(HOME, 'memory'),
			rootPath: HOME,
		}),
		resolveReadableDirectories: () => [],
		resolveSettings: () => ({
			autoClearAtPercent: 0.8,
			model: null,
			provider: 'claude',
			thinkingLevel: null,
		}),
	});
	return { requests, service };
};

beforeEach(() => {
	directory = mkdtempSync(path.join(tmpdir(), 'ensemblr-concierge-control-'));
	database = openEnsemblrDatabase({
		databasePath: path.join(directory, 'concierge.db'),
	}).database;
});

afterEach(() => {
	database.close();
	rmSync(directory, { force: true, recursive: true });
});

describe('the control wiring a Concierge session opens with', () => {
	it('hands the runtime the env overlay and the MCP endpoint', async () => {
		const { requests, service } = setup({
			wiring: async () => ({
				controlMcp: CONTROL_MCP,
				env: { ENSEMBLR_CONTROL_TOKEN: CONTROL_MCP.token },
				systemPromptAppend: 'You are the Concierge.',
			}),
		});

		await service.openSession({ fresh: true });

		expect(requests).toHaveLength(1);
		expect(requests[0]).toMatchObject({
			controlMcp: CONTROL_MCP,
			env: { ENSEMBLR_CONTROL_TOKEN: CONTROL_MCP.token },
			systemPromptAppend: 'You are the Concierge.',
		});
	});

	// The overlay carries a token minted for this one session, so the resolver
	// cannot be called blind: a wiring resolved for the wrong id would hand the
	// child somebody else's identity, and one resolved without the provider
	// cannot tell a runtime that brings its own MCP client from one that does not.
	it('resolves the wiring for the session and runtime being opened', async () => {
		const wiring = vi.fn(async () => ({}));
		const { service } = setup({ wiring });

		const opened = await service.openSession({ fresh: true });

		expect(wiring).toHaveBeenCalledWith({
			provider: 'claude',
			sessionId: opened.session?.id,
		});
	});

	it('opens without control tools when nothing resolves the wiring', async () => {
		const { requests, service } = setup();

		await service.openSession({ fresh: true });

		expect(requests[0]).toMatchObject({ controlMcp: null });
	});

	it('drops the control origin when the session detaches', async () => {
		const releaseControlOrigin = vi.fn();
		const { service } = setup({
			releaseControlOrigin,
			wiring: async () => ({ controlMcp: CONTROL_MCP }),
		});

		const opened = await service.openSession({ fresh: true });
		await service.shutdown();

		expect(releaseControlOrigin).toHaveBeenCalledWith(opened.session?.id);
	});
});
