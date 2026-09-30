import { describe, expect, test } from 'vitest';

import {
	createTimelineProjector,
	eventsToUIMessages,
} from '../../src/renderer/lib/agent-timeline/event-to-ui-message';
import { appendLiveEvents } from '../../src/renderer/lib/agent-timeline/streaming-delta-rows';
import type {
	AgentPersistedEnvelope,
	AgentSessionEventWire,
} from '../../src/shared/ipc';

function row(
	overrides: Partial<AgentSessionEventWire> & {
		payload?: AgentPersistedEnvelope | null;
	},
): AgentSessionEventWire {
	return {
		branchId: 'branch-1',
		createdAt: '2026-06-08T12:00:00.000Z',
		eventType: 'message',
		id: 'evt-default',
		ordinal: 0,
		payload: null,
		stream: 'protocol',
		turnId: 'turn-live',
		...overrides,
	};
}

function delta(
	ordinal: number,
	text: string,
	options: {
		kind?: 'reasoning-delta' | 'text-delta';
		parentToolCallId?: string;
		role?: 'agent' | 'tool';
	} & Partial<AgentSessionEventWire> = {},
): AgentSessionEventWire {
	const { kind, parentToolCallId, role, ...overrides } = options;
	return row({
		createdAt: new Date(ordinal * 1000).toISOString(),
		id: `delta:session-1:0:${ordinal}`,
		ordinal,
		payload: {
			kind: 'message',
			...(parentToolCallId ? { parentToolCallId } : {}),
			payload: { kind: kind ?? 'text-delta', text },
			role: role ?? 'agent',
		},
		...overrides,
	});
}

function textOf(event: AgentSessionEventWire | undefined): string {
	const envelope = event?.payload;
	if (envelope?.kind !== 'message' || !('text' in envelope.payload)) {
		throw new Error('expected a message row carrying text');
	}
	return envelope.payload.text;
}

describe('appendLiveEvents', () => {
	test('folds a thousand in-order deltas into the first row and one accumulated tail', () => {
		const deltas = Array.from({ length: 1000 }, (_, index) =>
			delta(index + 1, `t${index} `),
		);

		const cached = appendLiveEvents([], deltas);

		expect(cached).toHaveLength(2);
		expect(cached[0]).toBe(deltas[0]);
		expect(textOf(cached[1])).toBe(deltas.slice(1).map(textOf).join(''));
		expect(cached[1]?.ordinal).toBe(1000);
		expect(cached[1]?.id).toBe(deltas[999]?.id);
		expect(cached[1]?.createdAt).toBe(deltas[999]?.createdAt);
	});

	test('stays at two rows when the deltas arrive one flush at a time', () => {
		let cached: AgentSessionEventWire[] = [];
		const texts: string[] = [];

		for (let ordinal = 1; ordinal <= 1000; ordinal += 1) {
			texts.push(`t${ordinal} `);
			cached = appendLiveEvents(cached, [delta(ordinal, `t${ordinal} `)]);
			expect(cached.length).toBeLessThanOrEqual(2);
		}

		expect(cached).toHaveLength(2);
		expect(textOf(cached[0])).toBe('t1 ');
		expect(textOf(cached[1])).toBe(texts.slice(1).join(''));
	});

	test('keeps the first row of a run and the rows before it referentially stable', () => {
		const settled = row({
			id: 'evt-answer',
			ordinal: 0,
			payload: {
				kind: 'message',
				payload: { kind: 'text', text: 'earlier answer' },
				role: 'agent',
			},
		});
		const first = appendLiveEvents([settled], [delta(1, 'a'), delta(2, 'b')]);
		const second = appendLiveEvents(first, [delta(3, 'c')]);

		expect(second[0]).toBe(settled);
		expect(second[1]).toBe(first[1]);
		expect(second[2]).not.toBe(first[2]);
		expect(textOf(second[2])).toBe('bc');
	});

	test('does not modify the lists or rows it is given', () => {
		const existing = [delta(1, 'a'), delta(2, 'b')];
		const incoming = [delta(3, 'c'), delta(4, 'd')];
		const existingSnapshot = structuredClone(existing);
		const incomingSnapshot = structuredClone(incoming);

		const cached = appendLiveEvents(existing, incoming);

		expect(cached).not.toBe(existing);
		expect(existing).toEqual(existingSnapshot);
		expect(incoming).toEqual(incomingSnapshot);
		expect(textOf(cached[1])).toBe('bcd');
	});

	test.each([
		['another kind', { kind: 'reasoning-delta' as const }],
		['a subagent thread', { parentToolCallId: 'toolu_1' }],
		['another turn', { turnId: 'turn-2' }],
		['another branch', { branchId: 'branch-2' }],
		['another role', { role: 'tool' as const }],
	])('starts its own rows for a delta from %s', (_label, change) => {
		const cached = appendLiveEvents(
			[],
			[delta(1, 'a'), delta(2, 'b'), delta(3, 'c'), delta(4, 'd', change)],
		);

		expect(cached.map(textOf)).toEqual(['a', 'bc', 'd']);
	});

	test('folds deltas of one subagent thread', () => {
		const owned = (ordinal: number, text: string) =>
			delta(ordinal, text, { parentToolCallId: 'toolu_1' });

		const cached = appendLiveEvents(
			[],
			[owned(1, 'a'), owned(2, 'b'), owned(3, 'c')],
		);

		expect(cached.map(textOf)).toEqual(['a', 'bc']);
	});

	test('does not fold across a row that is not a delta', () => {
		const usage = row({
			eventType: 'context-usage',
			id: 'usage-1',
			ordinal: 3,
			payload: {
				kind: 'context-usage',
				usage: { contextWindow: 200_000, percent: null, tokens: 10 },
			},
		});

		const cached = appendLiveEvents(
			[],
			[delta(1, 'a'), delta(2, 'b'), usage, delta(4, 'c'), delta(5, 'd')],
		);

		expect(cached.map((event) => event.id)).toEqual([
			'delta:session-1:0:1',
			'delta:session-1:0:2',
			'usage-1',
			'delta:session-1:0:4',
			'delta:session-1:0:5',
		]);
	});

	test('bounds each stream separately when text and reasoning alternate in runs', () => {
		const stream = [
			...Array.from({ length: 50 }, (_, index) =>
				delta(index + 1, `r${index}`, { kind: 'reasoning-delta' }),
			),
			...Array.from({ length: 50 }, (_, index) =>
				delta(index + 51, `t${index}`),
			),
		];

		const cached = appendLiveEvents([], stream);

		expect(cached).toHaveLength(4);
		expect(cached.map((event) => event.ordinal)).toEqual([1, 50, 51, 100]);
	});

	test('never folds an empty chunk', () => {
		const cached = appendLiveEvents(
			[],
			[delta(1, ''), delta(2, ''), delta(3, 'a'), delta(4, ''), delta(5, 'b')],
		);

		expect(cached.map(textOf)).toEqual(['', '', 'a', '', 'b']);
	});
});

/** Feeds `rows` through the live cache the way flushes of `batchSize` events would. */
function cacheInBatches(
	rows: readonly AgentSessionEventWire[],
	batchSize: number,
): AgentSessionEventWire[] {
	let cached: AgentSessionEventWire[] = [];
	for (let start = 0; start < rows.length; start += batchSize) {
		cached = appendLiveEvents(cached, rows.slice(start, start + batchSize));
	}
	return cached;
}

function persisted(
	ordinal: number,
	envelope: AgentPersistedEnvelope,
	eventType = 'message',
): AgentSessionEventWire {
	return row({
		createdAt: new Date(ordinal * 1000).toISOString(),
		eventType,
		id: `evt-${ordinal}`,
		ordinal,
		payload: envelope,
	});
}

function userPrompt(ordinal: number, text: string): AgentSessionEventWire {
	return persisted(ordinal, {
		kind: 'message',
		payload: { kind: 'prompt', prompt: text },
		role: 'user',
	});
}

function streamOf(
	firstOrdinal: number,
	count: number,
	options: Parameters<typeof delta>[2] = {},
): AgentSessionEventWire[] {
	return Array.from({ length: count }, (_, index) =>
		delta(firstOrdinal + index, `${options.kind ?? 'text'}${index} `, options),
	);
}

describe('appendLiveEvents projection', () => {
	const fixtures: Array<[string, AgentSessionEventWire[]]> = [
		[
			'a text stream after a prompt',
			[userPrompt(0, 'go'), ...streamOf(1, 200)],
		],
		[
			'reasoning followed by text',
			[
				userPrompt(0, 'think'),
				...streamOf(1, 40, { kind: 'reasoning-delta' }),
				...streamOf(41, 40),
			],
		],
		[
			'a subagent thread around the main thread',
			[
				userPrompt(0, 'delegate'),
				...streamOf(1, 30),
				...streamOf(31, 30, { parentToolCallId: 'toolu_task_1' }),
				...streamOf(61, 30),
			],
		],
		[
			'two subagent threads',
			[
				userPrompt(0, 'delegate twice'),
				...streamOf(1, 25, { parentToolCallId: 'toolu_a' }),
				...streamOf(26, 25, { parentToolCallId: 'toolu_b' }),
			],
		],
		[
			'text either side of a tool call',
			[
				userPrompt(0, 'read it'),
				...streamOf(1, 20),
				persisted(21, {
					kind: 'message',
					payload: {
						input: { path: 'a.ts' },
						kind: 'tool-call',
						name: 'Read',
						toolCallId: 'call-1',
					},
					role: 'agent',
				}),
				persisted(22, {
					kind: 'message',
					payload: {
						isError: false,
						kind: 'tool-result',
						output: 'contents',
						toolCallId: 'call-1',
					},
					role: 'tool',
				}),
				...streamOf(23, 20),
			],
		],
		[
			'a stream the sealed message replaces',
			[
				userPrompt(0, 'answer'),
				...streamOf(1, 30),
				persisted(31, {
					kind: 'message',
					payload: { kind: 'text', text: 'the whole answer' },
					role: 'agent',
				}),
			],
		],
		[
			'two turns',
			[
				userPrompt(0, 'first'),
				...streamOf(1, 20),
				persisted(21, {
					kind: 'message',
					payload: { kind: 'text', text: 'first answer' },
					role: 'agent',
				}),
				persisted(
					22,
					{ kind: 'status', previous: 'streaming', status: 'idle' },
					'status',
				),
				userPrompt(23, 'second'),
				...streamOf(24, 20),
			],
		],
		[
			'a stream cut short by a failure',
			[
				userPrompt(0, 'go'),
				...streamOf(1, 15),
				persisted(
					16,
					{
						error: {
							code: 'boom',
							message: 'The provider fell over',
							recoverable: false,
						},
						kind: 'error',
					},
					'error',
				),
			],
		],
		[
			'a stream that restates the failure that ends it',
			[
				userPrompt(0, 'go'),
				delta(1, 'The provider '),
				delta(2, 'fell '),
				delta(3, 'over'),
				persisted(
					4,
					{
						error: {
							code: 'boom',
							message: 'The provider fell over',
							recoverable: false,
						},
						kind: 'error',
					},
					'error',
				),
			],
		],
		[
			'a row from another branch inside the run',
			[
				userPrompt(0, 'go'),
				...streamOf(1, 10),
				delta(11, 'stray ', { branchId: 'branch-2' }),
				...streamOf(12, 10),
			],
		],
	];

	test('drops a streamed restatement of the failure from the folded stream too', () => {
		const rows = [
			userPrompt(0, 'go'),
			delta(1, 'The provider '),
			delta(2, 'fell '),
			delta(3, 'over'),
			persisted(
				4,
				{
					error: {
						code: 'boom',
						message: 'The provider fell over',
						recoverable: false,
					},
					kind: 'error',
				},
				'error',
			),
		];

		const messages = eventsToUIMessages(cacheInBatches(rows, 1));

		expect(messages.map((message) => message.role)).toEqual(['user', 'system']);
	});

	test.each(fixtures)(
		'projects %s exactly as the per-chunk rows do',
		(_label, rows) => {
			const perChunk = eventsToUIMessages(rows);

			for (const batchSize of [1, 3, 7, rows.length]) {
				expect(eventsToUIMessages(cacheInBatches(rows, batchSize))).toEqual(
					perChunk,
				);
			}
		},
	);
});

/** Small deterministic generator, so a failing seed can be replayed. */
function seededRandom(seed: number): () => number {
	let state = seed;
	return () => {
		state = (state + 0x6d2b79f5) | 0;
		let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
		mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
		return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
	};
}

/** What a row builder draws on besides its ordinal: the random source and the tool calls issued so far. */
interface TranscriptState {
	pick: <T>(options: readonly T[]) => T;
	toolCalls: number;
}

/** One kind of transcript row, chosen when the roll falls under `below`. */
interface RowKind {
	below: number;
	build: (ordinal: number, state: TranscriptState) => AgentSessionEventWire;
	/** Whether the kind can be chosen yet; a tool result needs a call to answer. */
	ready?: (state: TranscriptState) => boolean;
}

const promptKind: RowKind = {
	below: 0.04,
	build: (ordinal) => userPrompt(ordinal, `prompt ${ordinal}`),
};

const errorKind: RowKind = {
	below: Number.POSITIVE_INFINITY,
	build: (ordinal) =>
		persisted(
			ordinal,
			{
				error: {
					code: 'boom',
					message: `failed ${ordinal}`,
					recoverable: false,
				},
				kind: 'error',
			},
			'error',
		),
};

/** The kinds a transcript draws from, in the order their roll thresholds apply. */
const rowKinds: readonly RowKind[] = [
	promptKind,
	{ below: 0.5, build: (ordinal) => delta(ordinal, `t${ordinal} `) },
	{
		below: 0.62,
		build: (ordinal) =>
			delta(ordinal, `r${ordinal} `, { kind: 'reasoning-delta' }),
	},
	{
		below: 0.74,
		build: (ordinal, state) =>
			delta(ordinal, `s${ordinal} `, {
				parentToolCallId: state.pick(['toolu_a', 'toolu_b']),
			}),
	},
	{
		below: 0.8,
		build: (ordinal, state) => {
			state.toolCalls += 1;
			return persisted(ordinal, {
				kind: 'message',
				payload: {
					input: { path: `f${state.toolCalls}.ts` },
					kind: 'tool-call',
					name: 'Read',
					toolCallId: `call-${state.toolCalls}`,
				},
				role: 'agent',
			});
		},
	},
	{
		below: 0.85,
		build: (ordinal, state) =>
			persisted(ordinal, {
				kind: 'message',
				payload: {
					isError: false,
					kind: 'tool-result',
					output: 'ok',
					toolCallId: `call-${state.toolCalls}`,
				},
				role: 'tool',
			}),
		ready: (state) => state.toolCalls > 0,
	},
	{
		below: 0.9,
		build: (ordinal) =>
			persisted(ordinal, {
				kind: 'message',
				payload: { kind: 'text', text: `sealed ${ordinal}` },
				role: 'agent',
			}),
	},
	{
		below: 0.94,
		build: (ordinal) =>
			persisted(
				ordinal,
				{ kind: 'status', previous: 'streaming', status: 'idle' },
				'status',
			),
	},
	{
		below: 0.98,
		build: (ordinal) =>
			persisted(
				ordinal,
				{
					kind: 'context-usage',
					usage: { contextWindow: 200_000, percent: null, tokens: ordinal },
				},
				'context-usage',
			),
	},
];

/**
 * Chooses the kind of row a roll lands on: the first kind whose threshold it is
 * under and that is ready, else an error row.
 * @param roll - A random number in [0, 1)
 * @param state - The transcript built so far
 * @returns The kind to build the next row from
 */
function rowKindFor(roll: number, state: TranscriptState): RowKind {
	return (
		rowKinds.find(
			(kind) => roll < kind.below && (kind.ready?.(state) ?? true),
		) ?? errorKind
	);
}

/** One random transcript: prompts, streamed chunks on several threads, and persisted rows between them. */
function randomTranscript(
	seed: number,
	length: number,
): AgentSessionEventWire[] {
	const random = seededRandom(seed);
	const state: TranscriptState = {
		pick: <T>(options: readonly T[]): T =>
			options[Math.floor(random() * options.length)] as T,
		toolCalls: 0,
	};
	return Array.from({ length }, (_, ordinal) => {
		const roll = random();
		const kind = ordinal === 0 ? promptKind : rowKindFor(roll, state);
		return kind.build(ordinal, state);
	});
}

describe('the live cache and the incremental projector together', () => {
	test.each(Array.from({ length: 60 }, (_, index) => index + 1))(
		'project random transcript %i exactly as the per-chunk rows do at every flush',
		(seed) => {
			const transcript = randomTranscript(seed, 120);
			const random = seededRandom(seed * 7919);
			const project = createTimelineProjector();
			let cached: AgentSessionEventWire[] = [];

			let flushed = 0;
			while (flushed < transcript.length) {
				const batch = 1 + Math.floor(random() * 6);
				cached = appendLiveEvents(
					cached,
					transcript.slice(flushed, flushed + batch),
				);
				flushed = Math.min(transcript.length, flushed + batch);

				expect(project(cached)).toEqual(
					eventsToUIMessages(transcript.slice(0, flushed)),
				);
			}
		},
	);
});
