import { describe, expect, it } from 'vitest';

import {
	AGENT_CONTROL_OPS,
	isSpawnOp,
	isWriteOp,
	validateArgs,
} from '../../src/shared/agent-control.ts';

describe('agent-control op classification', () => {
	it('marks mutating ops as writes and reads as non-writes', () => {
		expect(isWriteOp('spawnChatTab')).toBe(true);
		expect(isWriteOp('closeTab')).toBe(true);
		expect(isWriteOp('listTabs')).toBe(false);
		expect(isWriteOp('getConversationStatus')).toBe(false);
	});

	it('marks resource-creating ops as spawns', () => {
		expect(isSpawnOp('startConversation')).toBe(true);
		expect(isSpawnOp('launchHarness')).toBe(true);
		expect(isSpawnOp('closeTab')).toBe(false);
		expect(isSpawnOp('writeTerminal')).toBe(false);
	});

	it('treats focus ops as writes but not spawns', () => {
		expect(isWriteOp('focusTab')).toBe(true);
		expect(isWriteOp('focusPanel')).toBe(true);
		expect(isSpawnOp('focusTab')).toBe(false);
		expect(isSpawnOp('focusDockTab')).toBe(false);
	});

	it('treats the naming ops as writes that create nothing', () => {
		expect(isWriteOp('setBranchName')).toBe(true);
		expect(isWriteOp('setSummary')).toBe(true);
		expect(isSpawnOp('setBranchName')).toBe(false);
		expect(isSpawnOp('setSummary')).toBe(false);
	});

	it('treats the per-turn session brief as a read', () => {
		expect(isWriteOp('getSessionBrief')).toBe(false);
		expect(isSpawnOp('getSessionBrief')).toBe(false);
	});

	it('exposes every op exactly once', () => {
		expect(new Set(AGENT_CONTROL_OPS).size).toBe(AGENT_CONTROL_OPS.length);
	});
});

describe('validateArgs', () => {
	it('accepts a valid startConversation payload', () => {
		const result = validateArgs('startConversation', {
			prompt: 'do the thing',
			wait: true,
		});
		expect(result.ok).toBe(true);
	});

	it('rejects a startConversation missing its prompt', () => {
		const result = validateArgs('startConversation', { wait: true });
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toContain('prompt');
		}
	});

	it('rejects an empty required string', () => {
		const result = validateArgs('closeTab', { chatTabId: '  ' });
		expect(result.ok).toBe(false);
	});

	it('requires exactly one of terminalId or kind for stopTerminal', () => {
		expect(validateArgs('stopTerminal', { terminalId: 't1' }).ok).toBe(true);
		expect(validateArgs('stopTerminal', { kind: 'run' }).ok).toBe(true);
		expect(
			validateArgs('stopTerminal', { terminalId: 't1', kind: 'run' }).ok,
		).toBe(false);
		expect(validateArgs('stopTerminal', {}).ok).toBe(false);
	});

	it('requires filePath for file/diff tabs and commentBody for comment tabs', () => {
		expect(
			validateArgs('openTab', { variant: 'file', filePath: 'a.ts' }).ok,
		).toBe(true);
		expect(validateArgs('openTab', { variant: 'file' }).ok).toBe(false);
		expect(
			validateArgs('openTab', { variant: 'comment', commentBody: 'hi' }).ok,
		).toBe(true);
		expect(validateArgs('openTab', { variant: 'comment' }).ok).toBe(false);
	});

	it('defaults missing args to an empty object for no-arg ops', () => {
		expect(validateArgs('listWorkspaces', undefined).ok).toBe(true);
	});

	it('requires exactly one of terminalId or kind for focusDockTab', () => {
		expect(validateArgs('focusDockTab', { kind: 'setup' }).ok).toBe(true);
		expect(validateArgs('focusDockTab', { terminalId: 't1' }).ok).toBe(true);
		expect(validateArgs('focusDockTab', {}).ok).toBe(false);
	});

	it('restricts focusPanel to files/changes/checks', () => {
		expect(validateArgs('focusPanel', { panel: 'files' }).ok).toBe(true);
		expect(validateArgs('focusPanel', { panel: 'nope' }).ok).toBe(false);
	});

	it('caps a runaway setBranchName slug', () => {
		expect(validateArgs('setBranchName', { name: 'add-dark-mode' }).ok).toBe(
			true,
		);
		expect(validateArgs('setBranchName', { name: '' }).ok).toBe(false);
		expect(validateArgs('setBranchName', { name: 'a'.repeat(121) }).ok).toBe(
			false,
		);
	});

	it('requires both a title and a body for setSummary, within their caps', () => {
		expect(
			validateArgs('setSummary', { summary: '- Did the thing', title: 'Topic' })
				.ok,
		).toBe(true);
		expect(validateArgs('setSummary', { title: 'Topic' }).ok).toBe(false);
		expect(
			validateArgs('setSummary', {
				summary: 'body',
				title: 'a'.repeat(81),
			}).ok,
		).toBe(false);
		expect(
			validateArgs('setSummary', {
				summary: 'a'.repeat(4001),
				title: 'Topic',
			}).ok,
		).toBe(false);
	});
});
