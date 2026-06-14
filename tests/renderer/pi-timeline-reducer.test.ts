/**
 * Replays every captured Pi RPC fixture through the timeline reducer and
 * snapshot-tests the resulting state. Also proves the reducer is
 * deterministic (same fixture twice → identical state) and total (unknown
 * frames are no-ops).
 */

/// <reference types="bun" />

import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
	createPiTimelineState,
	replayPiTimeline,
} from '../../src/renderer/lib/pi-timeline';
import type { PiCapturedLine } from '../../src/shared/pi-rpc';
import { piCapturedLineSchema } from '../../src/shared/pi-rpc';

const FIXTURE_DIR = new URL(
	'../fixtures/pi-captures',
	import.meta.url,
).pathname;

function loadFixture(name: string): readonly PiCapturedLine[] {
	const content = readFileSync(join(FIXTURE_DIR, name), 'utf8');
	return content
		.split('\n')
		.filter((line) => line.length > 0)
		.map((line) => piCapturedLineSchema.parse(JSON.parse(line)));
}

const fixtureNames = readdirSync(FIXTURE_DIR)
	.filter((name) => name.endsWith('.jsonl'))
	.sort();

describe('pi timeline reducer', () => {
	for (const fixtureName of fixtureNames) {
		test(`${fixtureName} replay snapshot`, () => {
			const lines = loadFixture(fixtureName);
			const state = replayPiTimeline(lines);
			expect(state).toMatchSnapshot();
		});

		test(`${fixtureName} replay is deterministic`, () => {
			const lines = loadFixture(fixtureName);
			expect(replayPiTimeline(lines)).toEqual(replayPiTimeline(lines));
		});
	}

	test('no item is left open after a completed fixture', () => {
		for (const fixtureName of fixtureNames) {
			const state = replayPiTimeline(loadFixture(fixtureName));
			expect(state.cursor.openAssistantId).toBeNull();
			expect(state.cursor.openThinkingId).toBeNull();
			expect(Object.keys(state.cursor.runningTools)).toEqual([]);
			expect(state.session.streaming).toBe(false);
			for (const item of state.items) {
				if (item.kind === 'assistant-message') {
					expect(item.streaming).toBe(false);
				}
				if (item.kind === 'tool-call') {
					expect(item.status).not.toBe('running');
				}
			}
		}
	});

	test('abort fixture marks the turn aborted and cancels nothing twice', () => {
		const state = replayPiTimeline(loadFixture('abort-mid-turn.jsonl'));
		const footers = state.items.filter((item) => item.kind === 'turn-footer');
		expect(footers).toHaveLength(1);
		expect(footers[0]?.aborted).toBe(true);
	});

	test('permission-gate records approval handshake on tool calls', () => {
		const state = replayPiTimeline(loadFixture('permission-gate.jsonl'));
		const calls = state.items.flatMap((item) =>
			item.kind === 'tool-call'
				? [item]
				: item.kind === 'tool-group'
					? item.calls
					: [],
		);
		const withApproval = calls.filter((call) => call.approval !== null);
		expect(withApproval.length).toBeGreaterThanOrEqual(2);
		expect(withApproval.some((call) => call.status === 'error')).toBe(true);
		expect(withApproval.some((call) => call.status === 'success')).toBe(true);
		for (const call of withApproval) {
			expect(call.approval?.settledAtMs).not.toBeNull();
		}
	});

	test('multi-tool-chain groups consecutive tool calls', () => {
		const state = replayPiTimeline(loadFixture('multi-tool-chain.jsonl'));
		expect(state.items.some((item) => item.kind === 'tool-group')).toBe(true);
	});

	test('multi-turn produces two user messages and two footers', () => {
		const state = replayPiTimeline(loadFixture('multi-turn.jsonl'));
		const kinds = state.items.map((item) => item.kind);
		expect(kinds.filter((kind) => kind === 'user-message')).toHaveLength(2);
		expect(kinds.filter((kind) => kind === 'turn-footer')).toHaveLength(2);
	});

	test('unknown events are no-ops', () => {
		const initial = createPiTimelineState();
		// The parser filters unknowns; replay over garbage lines must yield the
		// initial state untouched.
		const garbage: PiCapturedLine[] = [
			{ ts: 1, stream: 'stdout', raw: 'not json at all' },
			{ ts: 2, stream: 'stdout', raw: '{"type":"never_seen_event"}' },
			{ ts: 3, stream: 'stderr', raw: 'noise' },
		];
		expect(replayPiTimeline(garbage)).toEqual(initial);
	});
});
