import type { On } from 'claude-code';
import { expect, test } from 'claude-code/testing';

import { KEEP_INSTRUCTIONS } from '../hooks/compact-keeper.ts';

const TRANSCRIPT = [
	{ role: 'user' as const, text: 'start the children', toolUses: [] },
];

function answerGit(on: On, stdout: string, exitCode = 0): void {
	on('process.run', () => ({
		value: {
			exitCode,
			isStderrTruncated: false,
			isStdoutTruncated: false,
			stderr: '',
			stdout,
		},
	}));
}

function captureInstructions(on: On, seen: (string | undefined)[]): void {
	on('session.compact', (_$, e) => {
		seen.push(e.instructions);
		return { skip: 'test' };
	});
}

test('asks every compaction to keep ids, jobs, branch, comments and decisions', async ($, on) => {
	const seen: (string | undefined)[] = [];
	answerGit(on, 'psoldunov/bundled-claude-code-mods\n');
	captureInstructions(on, seen);
	await $.session.compact({ messages: TRANSCRIPT, trigger: 'auto' });
	const [instructions] = seen;
	expect(instructions).toContain(KEEP_INSTRUCTIONS);
	for (const term of [
		'agentSessionId',
		'chatTabId',
		'jobId',
		'comment id',
		'decision',
	]) {
		expect(instructions).toContain(term);
	}
	expect(instructions).toContain('`psoldunov/bundled-claude-code-mods`');
});

test("keeps the person's own /compact instructions first", async ($, on) => {
	const seen: (string | undefined)[] = [];
	answerGit(on, '', 128);
	captureInstructions(on, seen);
	await $.session.compact({
		instructions: 'focus on the parser',
		messages: TRANSCRIPT,
		trigger: 'manual',
	});
	const [instructions] = seen;
	expect(instructions).toStartWith('focus on the parser\n\n');
	expect(instructions).not.toContain('workspace branch is currently');
});
