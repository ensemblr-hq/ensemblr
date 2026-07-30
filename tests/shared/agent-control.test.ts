import { describe, expect, it } from 'vitest';

import {
	AGENT_CONTROL_OPS,
	ASK_USER_QUESTION_LIMITS,
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

	// Reading a diff or the notes on it changes nothing, so both stay allowed in
	// every permission mode; filing a comment persists a row and is a write. None
	// of the three creates a tab, terminal, or conversation, so none is a spawn.
	it('treats the review reads as reads and only the comment write as a write', () => {
		expect(isWriteOp('getWorkspaceDiff')).toBe(false);
		expect(isWriteOp('getDiffComments')).toBe(false);
		expect(isWriteOp('addDiffComments')).toBe(true);
		expect(isSpawnOp('getWorkspaceDiff')).toBe(false);
		expect(isSpawnOp('getDiffComments')).toBe(false);
		expect(isSpawnOp('addDiffComments')).toBe(false);
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

	it('trims a long askUserQuestion header instead of rejecting the questionnaire', () => {
		const longHeader =
			'Islands versus vanilla script tags, and what each one costs us later on';
		const result = validateArgs('askUserQuestion', {
			questions: [
				{
					header: longHeader,
					options: [{ label: 'Islands' }, { label: 'Vanilla' }],
					question: 'Which rendering approach?',
				},
			],
		});
		expect(result.ok).toBe(true);
		if (result.ok) {
			const { questions } = result.value as {
				questions: { header?: string }[];
			};
			const trimmed = questions[0]?.header ?? '';
			expect(trimmed).toHaveLength(ASK_USER_QUESTION_LIMITS.maxHeaderLength);
			expect(longHeader.startsWith(trimmed)).toBe(true);
		}
	});

	it('accepts the header that used to blow the old 16-character cap', () => {
		expect(
			validateArgs('askUserQuestion', {
				questions: [
					{
						header: 'Islands vs vanilla',
						options: [{ label: 'Islands' }, { label: 'Vanilla' }],
						question: 'Which rendering approach?',
					},
				],
			}).ok,
		).toBe(true);
	});

	it('accepts repeated askUserQuestion headers, which the pager disambiguates', () => {
		const question = (text: string) => ({
			header: 'Scope',
			options: [{ label: 'Main' }, { label: 'Renderer' }],
			question: text,
		});
		expect(
			validateArgs('askUserQuestion', {
				questions: [
					question('Which part first?'),
					question('Which part after?'),
				],
			}).ok,
		).toBe(true);
	});

	it('accepts a bare workspace diff read and its two narrowing modes', () => {
		expect(validateArgs('getWorkspaceDiff', {}).ok).toBe(true);
		expect(validateArgs('getWorkspaceDiff', { stat: true }).ok).toBe(true);
		expect(
			validateArgs('getWorkspaceDiff', { file: 'src/main/main.ts' }).ok,
		).toBe(true);
	});

	// The two narrowing modes are alternatives, not a filter pair. Letting one
	// silently win leaves the caller unable to tell which read it got back.
	it('refuses a diff read that asks for a file and a stat at once', () => {
		expect(
			validateArgs('getWorkspaceDiff', { file: 'src/a.ts', stat: true }).ok,
		).toBe(false);
		expect(
			validateArgs('getWorkspaceDiff', { file: 'src/a.ts', stat: false }).ok,
		).toBe(true);
	});

	// The path reaches a git pathspec, so a traversal has to be refused at the
	// boundary rather than left to the git service's own check — an agent that
	// gets `invalid-args` can correct the path, one that gets a git failure
	// cannot tell a rejected path from a broken repository.
	it.each([
		['..', 'a bare parent'],
		['../outside.ts', 'a relative climb'],
		['src/../../outside.ts', 'a climb buried mid-path'],
		['/etc/passwd', 'an absolute POSIX path'],
		['C:\\Windows\\win.ini', 'an absolute Windows path'],
		['..\\outside.ts', 'a backslash climb'],
		['src/main\0.ts', 'an embedded NUL'],
		['', 'an empty path'],
	])('rejects %s as a diff target (%s)', (file) => {
		expect(validateArgs('getWorkspaceDiff', { file }).ok).toBe(false);
	});

	it('applies the same path rule to a comment target', () => {
		expect(
			validateArgs('addDiffComments', {
				comments: [{ body: 'nit', filePath: '../outside.ts' }],
			}).ok,
		).toBe(false);
	});

	it('accepts a comment with and without a line number', () => {
		expect(
			validateArgs('addDiffComments', {
				comments: [
					{ body: 'Line note', filePath: 'src/a.ts', lineNumber: 12 },
					{ body: 'File note', filePath: 'src/b.ts', lineNumber: null },
					{ body: 'Also a file note', filePath: 'src/c.ts' },
				],
			}).ok,
		).toBe(true);
	});

	it('rejects a zero or negative line number', () => {
		for (const lineNumber of [0, -1]) {
			expect(
				validateArgs('addDiffComments', {
					comments: [{ body: 'nit', filePath: 'src/a.ts', lineNumber }],
				}).ok,
			).toBe(false);
		}
	});

	it('rejects an empty batch, an empty body, and an oversized body', () => {
		expect(validateArgs('addDiffComments', { comments: [] }).ok).toBe(false);
		expect(
			validateArgs('addDiffComments', {
				comments: [{ body: '   ', filePath: 'src/a.ts' }],
			}).ok,
		).toBe(false);
		expect(
			validateArgs('addDiffComments', {
				comments: [{ body: 'x'.repeat(4_001), filePath: 'src/a.ts' }],
			}).ok,
		).toBe(false);
	});

	it('caps a runaway comment batch', () => {
		const comment = { body: 'nit', filePath: 'src/a.ts' };
		expect(
			validateArgs('addDiffComments', {
				comments: Array.from({ length: 50 }, () => comment),
			}).ok,
		).toBe(true);
		expect(
			validateArgs('addDiffComments', {
				comments: Array.from({ length: 51 }, () => comment),
			}).ok,
		).toBe(false);
	});
});
