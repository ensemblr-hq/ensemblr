import { describe, expect, it } from 'vitest';
import {
	createAgentActivityState,
	reduceAgentActivity,
} from '../../src/shared/agent-activity.ts';
import type { AgentPersistedEnvelope } from '../../src/shared/ipc/contracts/agent-session.ts';

const envelope = (
	payload: Extract<AgentPersistedEnvelope, { kind: 'message' }>['payload'],
	role: Extract<AgentPersistedEnvelope, { kind: 'message' }>['role'] = 'agent',
): AgentPersistedEnvelope => ({ kind: 'message', payload, role });

describe('agent activity projection', () => {
	it('does not resurrect a resolved tool call from a duplicate final message', () => {
		const started = reduceAgentActivity(
			createAgentActivityState(),
			envelope({
				input: { query: 'activity' },
				kind: 'tool-call',
				name: 'search',
				toolCallId: 'call-1',
			}),
		);
		const resolved = reduceAgentActivity(
			started,
			envelope(
				{
					isError: false,
					kind: 'tool-result',
					output: { ignored: true },
					toolCallId: 'call-1',
				},
				'tool',
			),
		);
		const duplicated = reduceAgentActivity(
			resolved,
			envelope({
				kind: 'message',
				parts: [
					{
						input: { query: 'activity' },
						kind: 'tool-call',
						name: 'search',
						toolCallId: 'call-1',
					},
				],
				role: 'assistant',
			}),
		);

		expect(duplicated.currentTools).toEqual([]);
	});

	it('keeps a settled call tombstoned across repeated streaming status', () => {
		const started = reduceAgentActivity(
			createAgentActivityState(),
			envelope({
				input: { path: 'README.md' },
				kind: 'tool-call',
				name: 'read',
				toolCallId: 'call-1',
			}),
		);
		const resolved = reduceAgentActivity(
			started,
			envelope(
				{
					isError: false,
					kind: 'tool-result',
					output: 'done',
					toolCallId: 'call-1',
				},
				'tool',
			),
		);
		const stillStreaming = reduceAgentActivity(resolved, {
			kind: 'status',
			previous: 'streaming',
			status: 'streaming',
		});
		const duplicateCall = reduceAgentActivity(
			stillStreaming,
			envelope({
				input: { path: 'README.md' },
				kind: 'tool-call',
				name: 'read',
				toolCallId: 'call-1',
			}),
		);
		const duplicateAssistantPart = reduceAgentActivity(
			duplicateCall,
			envelope({
				kind: 'message',
				parts: [
					{
						input: { path: 'README.md' },
						kind: 'tool-call',
						name: 'read',
						toolCallId: 'call-1',
					},
				],
				role: 'assistant',
			}),
		);

		expect(duplicateCall.currentTools).toEqual([]);
		expect(duplicateAssistantPart.currentTools).toEqual([]);
	});

	it('replaces a running tool with its latest normalized presentation', () => {
		const started = reduceAgentActivity(
			createAgentActivityState(),
			envelope({
				input: { query: 'old' },
				kind: 'tool-call',
				name: 'search',
				toolCallId: 'call-1',
			}),
		);
		const updated = reduceAgentActivity(
			started,
			envelope(
				{
					input: { query: 'new' },
					kind: 'tool-update',
					name: 'search',
					presentation: { title: 'Searching', version: 1 },
					toolCallId: 'call-1',
				},
				'tool',
			),
		);

		expect(updated.currentTools).toEqual([
			{
				input: { query: 'new' },
				name: 'search',
				presentation: { title: 'Searching', version: 1 },
				toolCallId: 'call-1',
			},
		]);
	});

	it('tracks parallel calls and removes only the completed call', () => {
		let state = createAgentActivityState();
		for (const toolCallId of ['call-1', 'call-2']) {
			state = reduceAgentActivity(
				state,
				envelope({ input: {}, kind: 'tool-call', name: 'read', toolCallId }),
			);
		}

		expect(state.currentTools).toHaveLength(2);
		state = reduceAgentActivity(
			state,
			envelope(
				{
					isError: true,
					kind: 'tool-result',
					output: 'failed',
					toolCallId: 'call-1',
				},
				'tool',
			),
		);
		expect(state.currentTools.map((tool) => tool.toolCallId)).toEqual([
			'call-2',
		]);
	});

	it('clears unresolved calls when an assistant response ends', () => {
		const started = reduceAgentActivity(
			createAgentActivityState(),
			envelope({
				input: {},
				kind: 'tool-call',
				name: 'bash',
				toolCallId: 'call-1',
			}),
		);
		const ended = reduceAgentActivity(
			started,
			envelope({
				endsResponse: true,
				kind: 'message',
				parts: [],
				role: 'assistant',
			}),
		);

		expect(ended.currentTools).toEqual([]);
	});

	it('keeps old calls cleared across idle and starts a clean next turn', () => {
		const started = reduceAgentActivity(
			createAgentActivityState(),
			envelope({
				input: {},
				kind: 'tool-call',
				name: 'bash',
				toolCallId: 'call-1',
			}),
		);
		const idle = reduceAgentActivity(started, {
			kind: 'status',
			previous: 'streaming',
			status: 'idle',
		});
		const delayed = reduceAgentActivity(
			idle,
			envelope({
				input: {},
				kind: 'tool-call',
				name: 'bash',
				toolCallId: 'call-1',
			}),
		);
		const nextTurn = reduceAgentActivity(delayed, {
			kind: 'status',
			previous: 'idle',
			status: 'streaming',
		});
		const reused = reduceAgentActivity(
			nextTurn,
			envelope({
				input: {},
				kind: 'tool-call',
				name: 'read',
				toolCallId: 'call-1',
			}),
		);

		expect(delayed.currentTools).toEqual([]);
		expect(reused.currentTools).toHaveLength(1);
	});

	it('keeps a running tool through recoverable runtime diagnostics', () => {
		const started = reduceAgentActivity(
			createAgentActivityState(),
			envelope({
				input: { path: 'README.md' },
				kind: 'tool-call',
				name: 'read',
				toolCallId: 'call-1',
			}),
		);
		const warned = reduceAgentActivity(started, {
			error: {
				message: 'Pi RPC stderr',
				recoverable: true,
			},
			kind: 'error',
		});
		const updated = reduceAgentActivity(
			warned,
			envelope(
				{
					input: { path: 'src/index.ts' },
					kind: 'tool-update',
					name: 'read',
					presentation: { title: 'Reading', version: 1 },
					toolCallId: 'call-1',
				},
				'tool',
			),
		);

		expect(warned).toBe(started);
		expect(updated.currentTools).toEqual([
			{
				input: { path: 'src/index.ts' },
				name: 'read',
				presentation: { title: 'Reading', version: 1 },
				toolCallId: 'call-1',
			},
		]);
	});

	it('returns the same state for text and reasoning deltas', () => {
		const state = createAgentActivityState([
			{ input: {}, name: 'read', toolCallId: 'call-1' },
		]);

		expect(
			reduceAgentActivity(state, envelope({ kind: 'text-delta', text: 'x' })),
		).toBe(state);
		expect(
			reduceAgentActivity(
				state,
				envelope({ kind: 'reasoning-delta', text: 'y' }),
			),
		).toBe(state);
	});

	it.each([
		{ kind: 'error', error: { message: 'failed' } } as const,
		{ kind: 'shutdown', reason: 'aborted' } as const,
		{
			kind: 'status',
			previous: 'streaming',
			status: 'errored',
		} as const,
	])(
		'clears unresolved calls for $kind lifecycle envelopes',
		(terminalEnvelope) => {
			const started = reduceAgentActivity(
				createAgentActivityState(),
				envelope({
					input: {},
					kind: 'tool-call',
					name: 'bash',
					toolCallId: 'call-1',
				}),
			);

			expect(
				reduceAgentActivity(started, terminalEnvelope).currentTools,
			).toEqual([]);
		},
	);
});
