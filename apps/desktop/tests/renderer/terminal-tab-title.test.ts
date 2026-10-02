import { describe, expect, test } from 'vitest';

import {
	type LiveTerminalTitle,
	resolveLiveTerminalTitle,
	sameLiveTerminalTitle,
} from '../../src/renderer/state/workspace/terminal-tab-title';

const LONG_TITLE = 'Refactor the auth middleware retry path end to end';
const CAPPED_TITLE = 'Refactor the auth middleware ret…';

/**
 * Builds a terminal lifecycle snapshot slice, defaulting every title source to
 * absent so each test states only the source it exercises.
 * @param overrides - Title fields to set on the snapshot.
 * @returns The snapshot slice `resolveLiveTerminalTitle` reads.
 */
function snapshot(
	overrides: Partial<{
		agentFullTitle: string | null;
		agentTitle: string | null;
		title: string;
	}> = {},
) {
	return {
		agentFullTitle: null,
		agentTitle: null,
		title: '',
		...overrides,
	};
}

describe('resolveLiveTerminalTitle: session-log harnesses', () => {
	test('keeps the untruncated title alongside the capped display form', () => {
		const result = resolveLiveTerminalTitle('codex', 'Codex', {
			agentFullTitle: LONG_TITLE,
			agentTitle: CAPPED_TITLE,
			title: 'some/cwd/path',
		});

		expect(result).toEqual({ display: CAPPED_TITLE, full: LONG_TITLE });
	});

	test('falls back to the display form when no fuller title was captured', () => {
		expect(
			resolveLiveTerminalTitle('codex', 'Codex', {
				agentFullTitle: null,
				agentTitle: 'Fix login redirect',
				title: 'some/cwd/path',
			}),
		).toEqual({ display: 'Fix login redirect', full: 'Fix login redirect' });

		expect(
			resolveLiveTerminalTitle('codex', 'Codex', {
				agentFullTitle: '   ',
				agentTitle: 'Fix login redirect',
				title: 'some/cwd/path',
			})?.full,
		).toBe('Fix login redirect');
	});

	test('ignores the OSC title, which for these harnesses is the cwd', () => {
		expect(
			resolveLiveTerminalTitle('codex', 'Codex', snapshot({ title: '~/repo' })),
		).toBeNull();
	});

	test('returns null while the title is still just the harness label', () => {
		expect(
			resolveLiveTerminalTitle(
				'codex',
				'Codex',
				snapshot({ agentTitle: 'Codex' }),
			),
		).toBeNull();
	});
});

describe('resolveLiveTerminalTitle: OSC-titled harnesses', () => {
	test('treats the stripped OSC title as both display and full form', () => {
		const result = resolveLiveTerminalTitle('claude-code', 'Claude Code', {
			agentFullTitle: null,
			agentTitle: null,
			title: 'Fix login redirect',
		});

		expect(result).toEqual({
			display: 'Fix login redirect',
			full: 'Fix login redirect',
		});
	});

	test('returns null for an empty title or the bare harness label', () => {
		expect(
			resolveLiveTerminalTitle('claude-code', 'Claude Code', snapshot()),
		).toBeNull();
		expect(
			resolveLiveTerminalTitle(
				'claude-code',
				'Claude Code',
				snapshot({ title: 'Claude Code' }),
			),
		).toBeNull();
	});
});

describe('sameLiveTerminalTitle', () => {
	const title: LiveTerminalTitle = { display: CAPPED_TITLE, full: LONG_TITLE };

	test('treats an equal pair as unchanged so the tab strip does not re-render', () => {
		expect(
			sameLiveTerminalTitle({ display: CAPPED_TITLE, full: LONG_TITLE }, title),
		).toBe(true);
	});

	test('detects a change in either form', () => {
		expect(sameLiveTerminalTitle(undefined, title)).toBe(false);
		expect(
			sameLiveTerminalTitle(
				{ display: CAPPED_TITLE, full: 'Something else' },
				title,
			),
		).toBe(false);
		expect(
			sameLiveTerminalTitle({ display: 'Other', full: LONG_TITLE }, title),
		).toBe(false);
	});
});
