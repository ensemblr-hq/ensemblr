/**
 * Renders the real timeline component set against the final reduced state of
 * every captured fixture — the render-side proof that each scenario in the
 * matrix displays cleanly (no throw, expected items present).
 */

/// <reference types="bun" />

import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';

import { PiSessionStatusBar } from '../../src/renderer/components/pi-timeline/pi-session-status-bar';
import { PiTimeline } from '../../src/renderer/components/pi-timeline/pi-timeline';
import { replayPiTimeline } from '../../src/renderer/lib/pi-timeline';
import type { PiTimelineState } from '../../src/renderer/types/pi-timeline';
import { piCapturedLineSchema } from '../../src/shared/pi-rpc';

const FIXTURE_DIR = new URL(
	'../fixtures/pi-captures',
	import.meta.url,
).pathname;

function stateFor(fixtureName: string): PiTimelineState {
	const content = readFileSync(join(FIXTURE_DIR, fixtureName), 'utf8');
	const lines = content
		.split('\n')
		.filter((line) => line.length > 0)
		.map((line) => piCapturedLineSchema.parse(JSON.parse(line)));
	return replayPiTimeline(lines);
}

function renderTimeline(state: PiTimelineState): string {
	return renderToStaticMarkup(
		<>
			<PiTimeline state={state} />
			<PiSessionStatusBar session={state.session} />
		</>,
	);
}

const fixtureNames = readdirSync(FIXTURE_DIR)
	.filter((name) => name.endsWith('.jsonl'))
	.sort();

describe('pi timeline rendering', () => {
	for (const fixtureName of fixtureNames) {
		test(`${fixtureName} renders without throwing`, () => {
			const state = stateFor(fixtureName);
			const markup = renderTimeline(state);
			expect(markup.length).toBeGreaterThan(0);
			expect(markup).toContain('data-role="session-status-bar"');
			expect(markup).toContain('data-role="user-prompt"');
		});
	}

	test('failing-tool renders an errored tool card', () => {
		const markup = renderTimeline(stateFor('failing-tool.jsonl'));
		expect(markup).toContain('data-status="error"');
		expect(markup).toContain('command not found');
	});

	test('abort-mid-turn renders the Stopped marker', () => {
		const markup = renderTimeline(stateFor('abort-mid-turn.jsonl'));
		expect(markup).toContain('Stopped');
	});

	test('multi-tool-chain renders a tool group summary', () => {
		const markup = renderTimeline(stateFor('multi-tool-chain.jsonl'));
		expect(markup).toContain('tool calls');
	});

	test('thinking renders a reasoned-for row', () => {
		const markup = renderTimeline(stateFor('thinking.jsonl'));
		expect(markup).toContain('Reasoned for');
	});

	test('file-edit renders diff stats in the tool summary', () => {
		const markup = renderTimeline(stateFor('file-edit.jsonl'));
		expect(markup).toMatch(/\+\d+ −\d+/);
	});

	test('status bar surfaces model, tokens, and cost', () => {
		const markup = renderTimeline(stateFor('plain-answer.jsonl'));
		expect(markup).toContain('gpt-5.3-codex-spark');
		expect(markup).toContain('tokens');
		expect(markup).toContain('$');
	});
});
