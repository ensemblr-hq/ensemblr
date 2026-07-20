import { describe, expect, test } from 'vitest';

import {
	mapTerminalSessionsToDockTabs,
	reduceTerminalInputActivity,
	terminalSessionToDockStatus,
	upsertTerminalSession,
} from '../../src/renderer/lib/terminal/terminal-tabs';
import type { TerminalSessionSnapshot } from '../../src/shared/ipc';

function createSession(
	overrides: Partial<TerminalSessionSnapshot> = {},
): TerminalSessionSnapshot {
	return {
		agentBusy: false,
		agentTitle: null,
		cols: 80,
		commandLabel: '/bin/zsh',
		createdAt: '2026-06-11T00:00:00.000Z',
		endedAt: null,
		exitCode: null,
		id: 'terminal-1',
		kind: 'terminal',
		previewUrl: null,
		rows: 24,
		status: 'running',
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
		expect(mapTerminalSessionsToDockTabs({ sessions: [] })).toEqual([]);
	});

	test('maps interactive sessions to terminal tabs and skips script sessions', () => {
		const tabs = mapTerminalSessionsToDockTabs({
			sessions: [
				createSession({ id: 'a', title: 'Terminal' }),
				createSession({ id: 'b', kind: 'run-script', title: 'Run' }),
				createSession({ id: 'c', status: 'failed', title: 'Terminal 2' }),
			],
		});

		expect(tabs).toHaveLength(2);
		expect(tabs[0]?.id).toBe('terminal:a');
		expect(tabs[0]?.terminalId).toBe('a');
		expect(tabs[0]?.status).toBe('idle');
		expect(tabs[1]?.status).toBe('warning');
		expect(tabs[1]?.sessionStatus).toBe('failed');
	});

	test('shows recent interactive terminal output as activity', () => {
		const tabs = mapTerminalSessionsToDockTabs({
			activeTerminalIds: new Set(['a', 'b']),
			sessions: [
				createSession({ id: 'a', title: 'Terminal' }),
				createSession({ id: 'b', status: 'exited', title: 'Terminal 2' }),
			],
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
