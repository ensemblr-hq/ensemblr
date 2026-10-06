import { describe, expect, test } from 'claude-code/testing';

import {
	type ContentBlock,
	chunkText,
	createTextRedactor,
	redactBlocks,
	type TextRedactor,
} from '../hooks/row-redaction.ts';

const TOKEN = 'ctl-token-0123456789abcdef';
const SECRET = 'hunter2-database-password';
const TOKEN_PLACEHOLDER = '[redacted:ENSEMBLR_CONTROL_TOKEN]';

function appRedactor(calls: string[]): TextRedactor {
	return async (piece) => {
		calls.push(piece);
		return piece.split(SECRET).join('[redacted:DB_PASSWORD]');
	};
}

function unreachableApp(): TextRedactor {
	return async (piece) => piece;
}

describe('redacting a row', () => {
	test('replaces workspace secrets and the control token in text and tool results', async () => {
		const redact = createTextRedactor(
			TOKEN,
			TOKEN_PLACEHOLDER,
			appRedactor([]),
		);
		const row: ContentBlock[] = [
			{ text: `env: DB=${SECRET}`, type: 'text' },
			{ content: `TOKEN=${TOKEN}`, tool_use_id: 'a', type: 'tool_result' },
			{
				content: [
					{ text: SECRET, type: 'text' },
					{ source: { data: 'x', type: 'base64' }, type: 'image' },
				],
				is_error: false,
				tool_use_id: 'b',
				type: 'tool_result',
			},
			{ id: 'c', input: { command: `echo ${SECRET}` }, type: 'tool_use' },
		];
		expect(await redactBlocks(row, redact)).toEqual([
			{ text: 'env: DB=[redacted:DB_PASSWORD]', type: 'text' },
			{
				content: `TOKEN=${TOKEN_PLACEHOLDER}`,
				tool_use_id: 'a',
				type: 'tool_result',
			},
			{
				content: [
					{ text: '[redacted:DB_PASSWORD]', type: 'text' },
					{ source: { data: 'x', type: 'base64' }, type: 'image' },
				],
				is_error: false,
				tool_use_id: 'b',
				type: 'tool_result',
			},
			{ id: 'c', input: { command: `echo ${SECRET}` }, type: 'tool_use' },
		]);
	});

	test('still hides the control token when the app does not answer', async () => {
		const redact = createTextRedactor(
			TOKEN,
			TOKEN_PLACEHOLDER,
			unreachableApp(),
		);
		const [block] = await redactBlocks(
			[{ text: `token ${TOKEN} and ${SECRET}`, type: 'text' }],
			redact,
		);
		expect(block).toEqual({
			text: `token ${TOKEN_PLACEHOLDER} and ${SECRET}`,
			type: 'text',
		});
	});

	test('hands back the very same row when nothing matched', async () => {
		const calls: string[] = [];
		const redact = createTextRedactor(
			TOKEN,
			TOKEN_PLACEHOLDER,
			appRedactor(calls),
		);
		const row: ContentBlock[] = [
			{ text: 'nothing secret here', type: 'text' },
			{
				content: [{ text: 'ok', type: 'text' }],
				tool_use_id: 'a',
				type: 'tool_result',
			},
		];
		expect((await redactBlocks(row, redact)) === row).toBe(true);
		expect(calls).toEqual(['nothing secret here']);
	});
});

test('cuts long text on line boundaries and joins back whole', () => {
	const line = `${'x'.repeat(99)}\n`;
	const text = line.repeat(4_000);
	const pieces = chunkText(text);
	expect(pieces.length).toBe(3);
	expect(pieces.join('')).toBe(text);
	for (const piece of pieces) {
		expect(piece.length).toBeLessThanOrEqual(150_000);
		expect(piece.endsWith('\n')).toBe(true);
	}
	expect(chunkText('short')).toEqual(['short']);
});

test('cuts one long line at whitespace, and an unbroken run at the limit', () => {
	const words = 'token-like-word '.repeat(12_500);
	const pieces = chunkText(words);
	expect(pieces.join('')).toBe(words);
	for (const piece of pieces) {
		expect(piece.length).toBeLessThanOrEqual(150_000);
		expect(piece.endsWith(' ')).toBe(true);
	}
	const run = 'x'.repeat(200_000);
	expect(chunkText(run).map((piece) => piece.length)).toEqual([
		150_000, 50_000,
	]);
});
