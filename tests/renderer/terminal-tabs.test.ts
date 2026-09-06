import { describe, expect, test } from 'vitest';

import { i18n } from '../../src/renderer/lib/i18n';

import {
	mapTerminalSessionsToDockTabs,
	reduceTerminalInputActivity,
	terminalSessionToDockStatus,
	upsertTerminalSession,
} from '../../src/renderer/lib/terminal';
import type { TerminalSessionSnapshot } from '../../src/shared/ipc';

function createSession(
	overrides: Partial<TerminalSessionSnapshot> = {},
): TerminalSessionSnapshot {
	return {
		agentBusy: false,
		agentFullTitle: null,
		agentTitle: null,
		cols: 80,
		commandLabel: '/bin/zsh',
		createdAt: '2026-06-11T00:00:00.000Z',
		endedAt: null,
		exitCode: null,
		foregroundCommand: null,
		harnessSessionId: null,
		id: 'terminal-1',
		kind: 'terminal',
		previewUrl: null,
		restored: false,
		rows: 24,
		scriptName: null,
		status: 'running',
		titleIsDefault: false,
		title: 'Terminal',
		workspaceId: 'workspace-1',
		...overrides,
	};
}

describe('reduceTerminalInputActivity', () => {
	test('does not treat typing as command activity until a command is submitted', () => {
		const typing = reduceTerminalInputActivity('', 'iperf');
		expect(typing).toEqual({
			commandSubmitted: false,
			interrupted: false,
			nextBuffer: 'iperf',
		});

		const submitted = reduceTerminalInputActivity(typing.nextBuffer, '\r');
		expect(submitted).toEqual({
			commandSubmitted: true,
			interrupted: false,
			nextBuffer: '',
		});
	});

	test('ignores empty submissions and clears activity on interrupt', () => {
		expect(reduceTerminalInputActivity('', '\r').commandSubmitted).toBe(false);
		expect(reduceTerminalInputActivity('iperf', '\u0003')).toEqual({
			commandSubmitted: false,
			interrupted: true,
			nextBuffer: '',
		});
	});

	test('skips ansi escape sequences so arrow keys are not treated as input', () => {
		expect(reduceTerminalInputActivity('', '\u001b[A')).toEqual({
			commandSubmitted: false,
			interrupted: false,
			nextBuffer: '',
		});
		expect(reduceTerminalInputActivity('', '\u001b[A\r').commandSubmitted).toBe(
			false,
		);
	});
});

describe('terminalSessionToDockStatus', () => {
	test('keeps an idle interactive shell from looking like active work', () => {
		expect(terminalSessionToDockStatus('running')).toBe('idle');
		expect(terminalSessionToDockStatus('failed')).toBe('warning');
		expect(terminalSessionToDockStatus('exited')).toBe('idle');
		expect(terminalSessionToDockStatus('stopped')).toBe('idle');
	});
});

describe('mapTerminalSessionsToDockTabs', () => {
	test('returns no terminal tabs when no interactive sessions exist', () => {
		expect(mapTerminalSessionsToDockTabs({ sessions: [], t: i18n.t })).toEqual(
			[],
		);
	});

	test('maps interactive sessions to terminal tabs and skips script sessions', () => {
		const tabs = mapTerminalSessionsToDockTabs({
			sessions: [
				createSession({ id: 'a', title: 'Terminal' }),
				createSession({ id: 'b', kind: 'run-script', title: 'Run' }),
				createSession({ id: 'c', status: 'failed', title: 'Terminal 2' }),
			],
			t: i18n.t,
		});

		expect(tabs).toHaveLength(2);
		expect(tabs[0]?.id).toBe('terminal:a');
		expect(tabs[0]?.terminalId).toBe('a');
		expect(tabs[0]?.status).toBe('idle');
		expect(tabs[1]?.status).toBe('warning');
		expect(tabs[1]?.sessionStatus).toBe('failed');
	});

	test('numbers unnamed terminals and leaves named ones alone', () => {
		const tabs = mapTerminalSessionsToDockTabs({
			sessions: [
				createSession({ id: 'a', titleIsDefault: true }),
				createSession({ id: 'b', titleIsDefault: true }),
				createSession({ id: 'c', title: 'Deploy' }),
			],
			t: i18n.t,
		});

		expect(tabs.map((tab) => tab.label)).toEqual([
			'Terminal 1',
			'Terminal 2',
			'Deploy',
		]);
	});

	// A number fixed at creation left the strip reading `Terminal 2, Terminal 4`
	// after two closes, and handed the freed 1 to the next terminal opened — so
	// two tabs could read `Terminal 1` at once.
	test('numbers by position in the strip, not by when the terminal opened', () => {
		const closedTheFirst = mapTerminalSessionsToDockTabs({
			sessions: [
				createSession({ id: 'b', titleIsDefault: true }),
				createSession({ id: 'c', titleIsDefault: true }),
			],
			t: i18n.t,
		});

		expect(closedTheFirst.map((tab) => tab.label)).toEqual([
			'Terminal 1',
			'Terminal 2',
		]);
	});

	// Numbering counts the strip it is building, so a named terminal takes a slot
	// rather than a number, and the tabs after it stay contiguous.
	test('counts a named terminal in the run without numbering it', () => {
		const tabs = mapTerminalSessionsToDockTabs({
			sessions: [
				createSession({ id: 'a', titleIsDefault: true }),
				createSession({ id: 'b', title: 'Deploy' }),
				createSession({ id: 'c', titleIsDefault: true }),
			],
			t: i18n.t,
		});

		expect(tabs.map((tab) => tab.label)).toEqual([
			'Terminal 1',
			'Deploy',
			'Terminal 3',
		]);
	});

	// Script sessions render in the fixed Setup/Run tabs, so they take no slot in
	// the terminal strip and must not push its numbering along.
	test('skips script sessions when numbering the strip', () => {
		const tabs = mapTerminalSessionsToDockTabs({
			sessions: [
				createSession({ id: 'a', kind: 'run-script', title: 'Run' }),
				createSession({ id: 'b', titleIsDefault: true }),
			],
			t: i18n.t,
		});

		expect(tabs.map((tab) => tab.label)).toEqual(['Terminal 1']);
	});

	test('names the running command and reverts once it finishes', () => {
		const running = mapTerminalSessionsToDockTabs({
			sessions: [
				createSession({
					foregroundCommand: 'npm',
					titleIsDefault: true,
				}),
				createSession({
					foregroundCommand: 'vim',
					id: 'b',
					title: 'Deploy',
				}),
			],
			t: i18n.t,
		});
		expect(running.map((tab) => tab.label)).toEqual(['npm', 'vim']);

		const finished = mapTerminalSessionsToDockTabs({
			sessions: [
				createSession({
					foregroundCommand: null,
					titleIsDefault: true,
				}),
			],
			t: i18n.t,
		});
		expect(finished[0]?.label).toBe('Terminal 1');
	});

	test('shows recent interactive terminal output as activity', () => {
		const tabs = mapTerminalSessionsToDockTabs({
			activeTerminalIds: new Set(['a', 'b']),
			sessions: [
				createSession({ id: 'a', title: 'Terminal' }),
				createSession({ id: 'b', status: 'exited', title: 'Terminal 2' }),
			],
			t: i18n.t,
		});

		expect(tabs[0]?.status).toBe('running');
		expect(tabs[1]?.status).toBe('idle');
	});
});

describe('upsertTerminalSession', () => {
	test('appends unknown sessions and replaces known ones in place', () => {
		const first = createSession({ id: 'a' });
		const second = createSession({ id: 'b' });

		const appended = upsertTerminalSession([first], second);
		expect(appended.map((session) => session.id)).toEqual(['a', 'b']);

		const replaced = upsertTerminalSession(
			appended,
			createSession({ id: 'a', status: 'exited' }),
		);
		expect(replaced.map((session) => session.id)).toEqual(['a', 'b']);
		expect(replaced[0]?.status).toBe('exited');
		// Immutability: the original list is untouched.
		expect(appended[0]?.status).toBe('running');
	});
});
