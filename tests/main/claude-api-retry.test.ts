import type { Query, SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { describe, expect, it, vi } from 'vitest';

import type {
	AgentAdapterSession,
	AgentError,
	AgentEvent,
	AgentSessionMetadata,
} from '../../src/main/agent-runtime/index.ts';
import {
	createApiRetryWatch,
	readCredentialEnvVars,
} from '../../src/main/claude-agent/api-retry-failure.ts';
import { createClaudeAgentAdapter } from '../../src/main/claude-agent/claude-agent-adapter.ts';
import { createSdkMessageNormalizer } from '../../src/main/claude-agent/sdk-message-normalizer.ts';
import { classifyAgentFailure } from '../../src/shared/agent-failure.ts';
import { CONTEXT_USAGE } from './helpers/claude-context-usage.ts';

const SESSION_ID = 'agent-session-retry';
const WORKSPACE_CWD = '/tmp/ensemblr/retry/ws';
const SECRET_KEY = 'sk-ant-not-a-real-key-0000';

interface RetryFrameInput {
	attempt?: number;
	error: string;
	error_status: number | null;
	max_retries?: number;
}

function retryFrame({
	attempt = 1,
	error,
	error_status,
	max_retries = 10,
}: RetryFrameInput): SDKMessage {
	return {
		attempt,
		error,
		error_status,
		max_retries,
		retry_delay_ms: 500,
		session_id: 'sdk-session-1',
		subtype: 'api_retry',
		type: 'system',
		uuid: '00000000-0000-4000-8000-000000000001',
	} as unknown as SDKMessage;
}

function interruptedResult(): SDKMessage {
	return {
		errors: ['Request was aborted.'],
		modelUsage: {},
		subtype: 'error_during_execution',
		total_cost_usd: 0,
		type: 'result',
	} as unknown as SDKMessage;
}

function textDelta(): SDKMessage {
	return {
		event: {
			delta: { text: 'hi', type: 'text_delta' },
			index: 0,
			type: 'content_block_delta',
		},
		type: 'stream_event',
	} as unknown as SDKMessage;
}

function errorsOf(events: readonly AgentEvent[]): AgentError[] {
	return events.flatMap((event) =>
		event.type === 'error' ? [event.error] : [],
	);
}

function statusesOf(events: readonly AgentEvent[]): string[] {
	return events.flatMap((event) =>
		event.type === 'status' ? [event.status] : [],
	);
}

function observeAll(
	watch: ReturnType<typeof createApiRetryWatch>,
	frames: readonly RetryFrameInput[],
): Array<AgentError | null> {
	return frames.map((frame) =>
		watch.observe({
			attempt: frame.attempt ?? 1,
			error: frame.error as never,
			error_status: frame.error_status,
			max_retries: frame.max_retries ?? 10,
		}),
	);
}

describe('api retry watch', () => {
	it('lets the first rejected attempt through, since the runtime refreshes credentials before it', () => {
		const watch = createApiRetryWatch([]);

		const [first] = observeAll(watch, [
			{ error: 'authentication_failed', error_status: 401 },
		]);

		expect(first).toBeNull();
	});

	it('stops on the second consecutive rejection with a fatal credentials failure', () => {
		const watch = createApiRetryWatch([]);

		const [, second] = observeAll(watch, [
			{ attempt: 1, error: 'authentication_failed', error_status: 401 },
			{ attempt: 2, error: 'authentication_failed', error_status: 401 },
		]);

		expect(second).not.toBeNull();
		expect(second?.recoverable).toBe(false);
		expect(second?.code).toBe('adapter-failure');
		expect(second?.detail).toContain('HTTP 401');
		expect(second?.detail).toContain('retry 2 of 10');
		expect(classifyAgentFailure(second as AgentError)).toBe('credentials');
	});

	it('never stops on causes that waiting can clear', () => {
		const watch = createApiRetryWatch(['ANTHROPIC_API_KEY']);

		const results = observeAll(watch, [
			{ error: 'overloaded', error_status: 529 },
			{ error: 'rate_limit', error_status: 429 },
			{ error: 'server_error', error_status: 500 },
			{ error: 'unknown', error_status: null },
			{ error: 'overloaded', error_status: 529 },
			{ error: 'server_error', error_status: 503 },
		]);

		expect(results.every((result) => result === null)).toBe(true);
	});

	it('restarts the count when a transient attempt breaks the run of rejections', () => {
		const watch = createApiRetryWatch([]);

		const results = observeAll(watch, [
			{ error: 'authentication_failed', error_status: 401 },
			{ error: 'overloaded', error_status: 529 },
			{ error: 'authentication_failed', error_status: 401 },
		]);

		expect(results).toEqual([null, null, null]);
	});

	it('restarts the count on reset, which the normalizer calls when a response gets through', () => {
		const watch = createApiRetryWatch([]);

		observeAll(watch, [{ error: 'authentication_failed', error_status: 401 }]);
		watch.reset();
		const [afterReset] = observeAll(watch, [
			{ error: 'authentication_failed', error_status: 401 },
		]);

		expect(afterReset).toBeNull();
	});

	it('reads a bare 401 as an authentication failure when the cause is unnamed', () => {
		const watch = createApiRetryWatch([]);

		const [, second] = observeAll(watch, [
			{ error: 'unknown', error_status: 401 },
			{ error: 'unknown', error_status: 401 },
		]);

		expect(classifyAgentFailure(second as AgentError)).toBe('credentials');
	});

	it('leaves a 400 to the runtime, whose retry after a context overflow is the repair', () => {
		const watch = createApiRetryWatch([]);

		const results = observeAll(watch, [
			{ error: 'invalid_request', error_status: 400 },
			{ error: 'invalid_request', error_status: 400 },
			{ error: 'unknown', error_status: 400 },
		]);

		expect(results).toEqual([null, null, null]);
	});

	it('reads a bare 404 as a missing model or endpoint rather than a credentials failure', () => {
		const watch = createApiRetryWatch(['ANTHROPIC_API_KEY']);

		const [, second] = observeAll(watch, [
			{ error: 'unknown', error_status: 404 },
			{ error: 'unknown', error_status: 404 },
		]);

		expect(second?.message).toMatch(/model or endpoint/);
		expect(second?.detail).not.toContain('ANTHROPIC_API_KEY');
		expect(classifyAgentFailure(second as AgentError)).toBe('unknown');
	});

	it.each([
		['oauth_org_not_allowed', 403, 'credentials'],
		['account_on_hold', 403, 'credentials'],
		['verification_required', 403, 'credentials'],
		['cloud_credential_error', null, 'credentials'],
		['billing_error', 400, 'rate-limit'],
		['model_not_found', 404, 'unknown'],
	] as const)('classifies %s as %s', (error, status, expected) => {
		const watch = createApiRetryWatch([]);

		const [, second] = observeAll(watch, [
			{ error, error_status: status },
			{ error, error_status: status },
		]);

		expect(second).not.toBeNull();
		expect(classifyAgentFailure(second as AgentError)).toBe(expected);
	});

	it('names a credential variable in the environment on an authentication failure', () => {
		const watch = createApiRetryWatch(['ANTHROPIC_API_KEY']);

		const [, second] = observeAll(watch, [
			{ error: 'authentication_failed', error_status: 401 },
			{ error: 'authentication_failed', error_status: 401 },
		]);

		expect(second?.detail).toMatch(/ANTHROPIC_API_KEY is set/);
		expect(classifyAgentFailure(second as AgentError)).toBe('credentials');
	});

	it('leaves the credential hint off a failure that is not about authentication', () => {
		const watch = createApiRetryWatch(['ANTHROPIC_API_KEY']);

		const [, second] = observeAll(watch, [
			{ error: 'billing_error', error_status: 400 },
			{ error: 'billing_error', error_status: 400 },
		]);

		expect(second?.detail).not.toContain('ANTHROPIC_API_KEY');
	});
});

describe('readCredentialEnvVars', () => {
	it('names the credential variables holding a value, never the value itself', () => {
		const names = readCredentialEnvVars({
			ANTHROPIC_API_KEY: SECRET_KEY,
			ANTHROPIC_AUTH_TOKEN: '   ',
			CLAUDE_CODE_OAUTH_TOKEN: 'oauth-token',
			PATH: '/usr/bin',
		});

		expect(names).toEqual(['ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN']);
		expect(names.join(' ')).not.toContain(SECRET_KEY);
	});
});

describe('normalizer api_retry handling', () => {
	function createNormalizer(): {
		normalizer: ReturnType<typeof createSdkMessageNormalizer>;
		stops: () => number;
	} {
		let stops = 0;
		const normalizer = createSdkMessageNormalizer({
			credentialEnvVars: ['ANTHROPIC_API_KEY'],
			now: () => new Date('2026-09-27T12:00:00.000Z'),
			onUnrecoverableRetry: () => {
				stops += 1;
			},
		});
		return { normalizer, stops: () => stops };
	}

	it('reports a futile retry loop once and asks the adapter to stop the turn', () => {
		const { normalizer, stops } = createNormalizer();
		normalizer.beginTurn();

		const events = [
			retryFrame({
				attempt: 1,
				error: 'authentication_failed',
				error_status: 401,
			}),
			retryFrame({
				attempt: 2,
				error: 'authentication_failed',
				error_status: 401,
			}),
			retryFrame({
				attempt: 3,
				error: 'authentication_failed',
				error_status: 401,
			}),
			retryFrame({
				attempt: 4,
				error: 'authentication_failed',
				error_status: 401,
			}),
		].flatMap((frame) => normalizer.normalize(frame));

		const errors = errorsOf(events);
		expect(errors).toHaveLength(1);
		expect(errors[0]?.recoverable).toBe(false);
		expect(errors[0]?.detail).toContain('ANTHROPIC_API_KEY');
		expect(stops()).toBe(1);
	});

	it('settles the stopped turn on its result without a second error row', () => {
		const { normalizer } = createNormalizer();
		normalizer.beginTurn();
		normalizer.normalize(
			retryFrame({
				attempt: 1,
				error: 'authentication_failed',
				error_status: 401,
			}),
		);
		normalizer.normalize(
			retryFrame({
				attempt: 2,
				error: 'authentication_failed',
				error_status: 401,
			}),
		);

		const events = normalizer.normalize(interruptedResult());

		expect(errorsOf(events)).toEqual([]);
		expect(statusesOf(events)).toEqual(['idle']);
	});

	it('still reports an ordinary failed result on a turn it did not stop', () => {
		const { normalizer } = createNormalizer();
		normalizer.beginTurn();

		const events = normalizer.normalize(interruptedResult());

		expect(errorsOf(events)).toHaveLength(1);
	});

	it('stays silent while the runtime retries an overloaded server', () => {
		const { normalizer, stops } = createNormalizer();
		normalizer.beginTurn();

		const events = Array.from({ length: 10 }, (_, index) =>
			retryFrame({
				attempt: index + 1,
				error: 'overloaded',
				error_status: 529,
			}),
		).flatMap((frame) => normalizer.normalize(frame));

		expect(events).toEqual([]);
		expect(stops()).toBe(0);
	});

	it('forgets a rejection once a response starts streaming', () => {
		const { normalizer, stops } = createNormalizer();
		normalizer.beginTurn();

		normalizer.normalize(
			retryFrame({
				attempt: 1,
				error: 'authentication_failed',
				error_status: 401,
			}),
		);
		normalizer.normalize(textDelta());
		const events = normalizer.normalize(
			retryFrame({
				attempt: 1,
				error: 'authentication_failed',
				error_status: 401,
			}),
		);

		expect(errorsOf(events)).toEqual([]);
		expect(stops()).toBe(0);
	});

	it('re-arms for the next prompt even when the stopped turn never reported a result', () => {
		const { normalizer, stops } = createNormalizer();
		normalizer.beginTurn();
		normalizer.normalize(
			retryFrame({
				attempt: 1,
				error: 'authentication_failed',
				error_status: 401,
			}),
		);
		normalizer.normalize(
			retryFrame({
				attempt: 2,
				error: 'authentication_failed',
				error_status: 401,
			}),
		);
		normalizer.settleTurn();

		normalizer.beginTurn();
		const events = [
			retryFrame({
				attempt: 1,
				error: 'authentication_failed',
				error_status: 401,
			}),
			retryFrame({
				attempt: 2,
				error: 'authentication_failed',
				error_status: 401,
			}),
		].flatMap((frame) => normalizer.normalize(frame));

		expect(errorsOf(events)).toHaveLength(1);
		expect(stops()).toBe(2);
	});
});

/** A query whose messages the test pushes, recording every interrupt. */
function createScriptedQuery(
	onInterrupt: (push: (message: SDKMessage) => void) => Promise<void>,
): {
	interrupts: () => number;
	push: (message: SDKMessage) => void;
	query: Query;
} {
	const queued: SDKMessage[] = [];
	let wake: (() => void) | null = null;
	let interrupts = 0;

	const push = (message: SDKMessage): void => {
		queued.push(message);
		wake?.();
		wake = null;
	};

	const iterator = (async function* (): AsyncGenerator<SDKMessage, void> {
		while (true) {
			const next = queued.shift();
			if (next) {
				yield next;
				continue;
			}
			await new Promise<void>((resolve) => {
				wake = resolve;
			});
		}
	})();

	const query = Object.assign(iterator, {
		applyFlagSettings: async () => undefined,
		close: () => undefined,
		getContextUsage: async () => CONTEXT_USAGE,
		interrupt: async () => {
			interrupts += 1;
			await onInterrupt(push);
		},
		setMaxThinkingTokens: async () => undefined,
		setModel: async () => undefined,
		setPermissionMode: async () => undefined,
	}) as unknown as Query;

	return { interrupts: () => interrupts, push, query };
}

function createMetadata(): AgentSessionMetadata {
	return {
		args: [],
		command: 'claude',
		cwd: WORKSPACE_CWD,
		env: {},
		id: SESSION_ID,
		label: 'Retry',
		model: null,
		piAgentDirectoryPreserved: true,
		provider: 'claude',
		sessionId: null,
		startedAt: '2026-01-01T00:00:00.000Z',
		status: 'starting',
		thinking: null,
		updatedAt: '2026-01-01T00:00:00.000Z',
	};
}

async function openSession(
	scripted: ReturnType<typeof createScriptedQuery>,
): Promise<{
	adapter: ReturnType<typeof createClaudeAgentAdapter>;
	events: AgentEvent[];
	session: AgentAdapterSession;
}> {
	const adapter = createClaudeAgentAdapter({
		queryFn: (() => scripted.query) as never,
		resolveBaseEnv: () => ({ ANTHROPIC_API_KEY: SECRET_KEY, PATH: '/usr/bin' }),
	});
	const session = await adapter.createSession({
		metadata: createMetadata(),
		request: { agentSessionId: SESSION_ID, workspaceCwd: WORKSPACE_CWD },
	});
	const events: AgentEvent[] = [];
	session.subscribe((event) => events.push(event));
	return { adapter, events, session };
}

describe('claude adapter futile retry loop', () => {
	it('shows the failure and interrupts the turn instead of spinning through the backoff', async () => {
		const scripted = createScriptedQuery(async (push) => {
			push(interruptedResult());
		});
		const { adapter, events, session } = await openSession(scripted);
		try {
			await session.submit({ prompt: 'hello' });
			scripted.push(
				retryFrame({
					attempt: 1,
					error: 'authentication_failed',
					error_status: 401,
				}),
			);
			scripted.push(
				retryFrame({
					attempt: 2,
					error: 'authentication_failed',
					error_status: 401,
				}),
			);

			await vi.waitFor(() => expect(statusesOf(events).at(-1)).toBe('idle'));

			const errors = errorsOf(events);
			expect(errors).toHaveLength(1);
			expect(classifyAgentFailure(errors[0] as AgentError)).toBe('credentials');
			expect(errors[0]?.detail).toContain('ANTHROPIC_API_KEY');
			expect(JSON.stringify(events)).not.toContain(SECRET_KEY);
			expect(scripted.interrupts()).toBe(1);
			expect(events.some((event) => event.type === 'shutdown')).toBe(false);
		} finally {
			await adapter.shutdown();
		}
	});

	it('settles the turn itself when the interrupt never reaches the runtime', async () => {
		const scripted = createScriptedQuery(async () => {
			throw new Error('control channel closed');
		});
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
		const { adapter, events, session } = await openSession(scripted);
		try {
			await session.submit({ prompt: 'hello' });
			scripted.push(
				retryFrame({
					attempt: 1,
					error: 'authentication_failed',
					error_status: 401,
				}),
			);
			scripted.push(
				retryFrame({
					attempt: 2,
					error: 'authentication_failed',
					error_status: 401,
				}),
			);

			await vi.waitFor(() => expect(statusesOf(events).at(-1)).toBe('idle'));

			expect(errorsOf(events)).toHaveLength(1);
			expect(warn).toHaveBeenCalled();
		} finally {
			warn.mockRestore();
			await adapter.shutdown();
		}
	});
});
