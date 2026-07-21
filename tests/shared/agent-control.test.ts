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
});
