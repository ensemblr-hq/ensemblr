import type { On } from 'claude-code';
import { expect, mock, test } from 'claude-code/testing';

import { BLOCK_NAME } from '../hooks/ticket-context.ts';

const ENDPOINT_ENV = {
	ENSEMBLR_CONTROL_TOKEN: 'ctl-token-0123456789abcdef',
	ENSEMBLR_CONTROL_URL: 'http://127.0.0.1:4100',
};

const BASE_BLOCKS = [
	{ name: 'currentDate', text: "Today's date is 2026-10-06." },
];

function answerIssue(on: On, issue: unknown, ops: string[] = []): void {
	on('http.fetch', (_$, e) => {
		ops.push((JSON.parse(e.init?.body ?? '{}') as { op: string }).op);
		return {
			value: {
				headers: {},
				ok: true,
				status: 200,
				text: JSON.stringify({ data: { issue }, ok: true }),
			},
		};
	});
}

function answerCore(on: On): void {
	on('prompt.context', (_$, e) => ({ blocks: e.blocks }));
}

test('adds the linked issue after the engine blocks', async ($, on) => {
	const ops: string[] = [];
	mock.env(on, ENDPOINT_ENV);
	answerIssue(
		on,
		{
			description: 'Ship four mods.\nKeep them UI-free.',
			identifier: 'THE-240',
			title: 'Bundle Claude Code mods',
			url: 'https://linear.app/x/issue/THE-240',
		},
		ops,
	);
	answerCore(on);
	const { blocks } = await $.prompt.context({ blocks: BASE_BLOCKS });
	expect(ops).toEqual(['getLinkedIssue']);
	expect(blocks.map((block) => block.name)).toEqual([
		'currentDate',
		BLOCK_NAME,
	]);
	const text = blocks.at(-1)?.text ?? '';
	expect(text).toContain('THE-240: Bundle Claude Code mods');
	expect(text).toContain('URL: https://linear.app/x/issue/THE-240');
	expect(text).toContain(
		'<issue-description>\nShip four mods.\nKeep them UI-free.\n</issue-description>',
	);
});

test('says so when the issue has no description', async ($, on) => {
	mock.env(on, ENDPOINT_ENV);
	answerIssue(on, {
		description: null,
		identifier: 'THE-1',
		title: 'T',
		url: null,
	});
	answerCore(on);
	const { blocks } = await $.prompt.context({ blocks: BASE_BLOCKS });
	expect(blocks.at(-1)?.text).toBe(
		'This workspace was created from Linear issue THE-1: T\nThe issue has no description.',
	);
});

test('adds nothing when no issue is linked', async ($, on) => {
	mock.env(on, ENDPOINT_ENV);
	answerIssue(on, null);
	answerCore(on);
	const { blocks } = await $.prompt.context({ blocks: BASE_BLOCKS });
	expect(blocks).toEqual(BASE_BLOCKS);
});

test('adds nothing outside an Ensemblr session', async ($, on) => {
	const ops: string[] = [];
	mock.env(on, {});
	answerIssue(
		on,
		{ description: 'x', identifier: 'A-1', title: 't', url: null },
		ops,
	);
	answerCore(on);
	const { blocks } = await $.prompt.context({ blocks: BASE_BLOCKS });
	expect(blocks).toEqual(BASE_BLOCKS);
	expect(ops).toEqual([]);
});
