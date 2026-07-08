import { describe, expect, test } from 'vitest';

import {
	mapTerminalSessionsToDockTabs,
	terminalSessionToDockStatus,
	upsertTerminalSession,
} from '../../src/renderer/lib/terminal/terminal-tabs';
import type { TerminalSessionSnapshot } from '../../src/shared/ipc';

function createSession(
	overrides: Partial<TerminalSessionSnapshot> = {},
): TerminalSessionSnapshot {
	return {
		cols: 80,
		commandLabel: '/bin/zsh',
		createdAt: '2026-06-11T00:00:00.000Z',
		endedAt: null,
		exitCode: null,
		id: 'terminal-1',
		kind: 'terminal',
		rows: 24,
		status: 'running',
		title: 'Terminal',
		workspaceId: 'workspace-1',
		...overrides,
	};
}

describe('terminalSessionToDockStatus', () => {
	test('maps session statuses to dock badge statuses', () => {
		expect(terminalSessionToDockStatus('running')).toBe('running');
		expect(terminalSessionToDockStatus('failed')).toBe('warning');
		expect(terminalSessionToDockStatus('exited')).toBe('idle');
		expect(terminalSessionToDockStatus('stopped')).toBe('idle');
	});
});

describe('mapTerminalSessionsToDockTabs', () => {
	test('returns the placeholder default tab when no interactive sessions exist', () => {
		const tabs = mapTerminalSessionsToDockTabs([]);

		expect(tabs).toHaveLength(1);
		expect(tabs[0]?.isDefault).toBe(true);
		expect(tabs[0]?.terminalId).toBeNull();
	});

	test('maps interactive sessions to terminal tabs and skips script sessions', () => {
		const tabs = mapTerminalSessionsToDockTabs([
			createSession({ id: 'a', title: 'Terminal' }),
			createSession({ id: 'b', kind: 'run-script', title: 'Run' }),
			createSession({ id: 'c', status: 'failed', title: 'Terminal 2' }),
		]);

		expect(tabs).toHaveLength(2);
		expect(tabs[0]?.id).toBe('terminal:a');
		expect(tabs[0]?.terminalId).toBe('a');
		expect(tabs[0]?.status).toBe('running');
		expect(tabs[1]?.status).toBe('warning');
		expect(tabs[1]?.sessionStatus).toBe('failed');
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
