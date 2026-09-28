import { describe, expect, test } from 'vitest';

import {
	buildWorkspaceScriptSummaries,
	scriptSummaryToDockStatus,
} from '../../src/renderer/lib/terminal';
import type { TerminalSessionSnapshot } from '../../src/shared/ipc';

/** Builds a setup-script session snapshot with any overrides the test needs. */
function setupSession(
	overrides: Partial<TerminalSessionSnapshot> = {},
): TerminalSessionSnapshot {
	return {
		agentBusy: false,
		agentFullTitle: null,
		agentTitle: null,
		cols: 80,
		commandLabel: 'sudo apt install jq',
		createdAt: '2026-09-28T00:00:00.000Z',
		endedAt: null,
		exitCode: null,
		foregroundCommand: null,
		harnessSessionId: null,
		id: 'setup-1',
		kind: 'setup-script',
		previewUrl: null,
		restored: false,
		rows: 24,
		scriptName: null,
		secretPrompt: null,
		shell: '/bin/sh',
		status: 'running',
		titleIsDefault: true,
		title: 'Setup',
		workspaceId: 'workspace-1',
		...overrides,
	};
}

describe('script summaries and a password prompt', () => {
	test('carries the prompt a running script is blocked on and lights the tab', () => {
		const { setup } = buildWorkspaceScriptSummaries({
			sessions: [
				setupSession({ secretPrompt: '[sudo] password for philipp:' }),
			],
			settings: null,
		});

		expect(setup.secretPrompt).toBe('[sudo] password for philipp:');
		expect(scriptSummaryToDockStatus(setup)).toBe('warning');
	});

	test('drops a prompt left on a session that is no longer running', () => {
		const { setup } = buildWorkspaceScriptSummaries({
			sessions: [
				setupSession({
					secretPrompt: '[sudo] password for philipp:',
					status: 'stopped',
				}),
			],
			settings: null,
		});

		expect(setup).not.toHaveProperty('secretPrompt');
		expect(scriptSummaryToDockStatus(setup)).toBe('idle');
	});

	test('leaves a running script without a prompt reading as running', () => {
		const { setup } = buildWorkspaceScriptSummaries({
			sessions: [setupSession()],
			settings: null,
		});

		expect(setup).not.toHaveProperty('secretPrompt');
		expect(scriptSummaryToDockStatus(setup)).toBe('running');
	});
});
