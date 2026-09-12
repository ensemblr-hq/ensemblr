import assert from 'node:assert/strict';
import test from 'node:test';

import { createJsonlLineStream } from '../../src/main/pi-ipc/jsonl-line-stream.ts';

test('emits one line per LF, splits chunked lines correctly', () => {
	const lines: string[] = [];
	const stream = createJsonlLineStream({ onLine: (line) => lines.push(line) });

	stream.feed('first\nsecond\nthird');
	stream.feed('-suffix\nfourth\n');

	assert.deepEqual(lines, ['first', 'second', 'third-suffix', 'fourth']);
});

test('handles LF straddling chunk boundary', () => {
	const lines: string[] = [];
	const stream = createJsonlLineStream({ onLine: (line) => lines.push(line) });

	stream.feed('alpha');
	stream.feed('\n');
	stream.feed('be');
	stream.feed('ta\n');

	assert.deepEqual(lines, ['alpha', 'beta']);
});

test('strips trailing CR for CRLF line endings', () => {
	const lines: string[] = [];
	const stream = createJsonlLineStream({ onLine: (line) => lines.push(line) });

	stream.feed('hello\r\nworld\r\n');

	assert.deepEqual(lines, ['hello', 'world']);
});

test('passes empty lines through as empty string', () => {
	const lines: string[] = [];
	const stream = createJsonlLineStream({ onLine: (line) => lines.push(line) });

	stream.feed('one\n\nthree\n');

	assert.deepEqual(lines, ['one', '', 'three']);
});

test('flush emits trailing partial line as a final line', () => {
	const lines: string[] = [];
	const stream = createJsonlLineStream({ onLine: (line) => lines.push(line) });

	stream.feed('done\npartial');
	stream.flush();

	assert.deepEqual(lines, ['done', 'partial']);
});

test('flush is a no-op when buffer is empty', () => {
	const lines: string[] = [];
	const stream = createJsonlLineStream({ onLine: (line) => lines.push(line) });

	stream.feed('a\nb\n');
	stream.flush();
	stream.flush();

	assert.deepEqual(lines, ['a', 'b']);
});

test('drops a single oversize line and emits onOversize, then resumes', () => {
	const lines: string[] = [];
	const oversize: Array<{ droppedBytes: number; firstBytes: string }> = [];
	const stream = createJsonlLineStream({
		maxLineBytes: 16,
		onLine: (line) => lines.push(line),
		onOversize: (info) => oversize.push(info),
	});

	stream.feed('ok\n');
	stream.feed('aaaaaaaaaaaaaaaaaaaaaaaa');
	stream.feed('bbb\nrecovered\n');

	assert.deepEqual(lines, ['ok', 'recovered']);
	assert.equal(oversize.length, 1);
	const firstOversize = oversize[0];
	assert.ok(firstOversize);
	assert.ok(firstOversize.droppedBytes > 16);
	assert.ok(firstOversize.firstBytes.startsWith('aaaa'));
});

test('does NOT trip oversize when LF arrives within cap', () => {
	const lines: string[] = [];
	const oversize: Array<{ droppedBytes: number; firstBytes: string }> = [];
	const stream = createJsonlLineStream({
		maxLineBytes: 16,
		onLine: (line) => lines.push(line),
		onOversize: (info) => oversize.push(info),
	});

	stream.feed('aaaaaaaaaaaaaaaa\n');

	assert.deepEqual(lines, ['aaaaaaaaaaaaaaaa']);
	assert.equal(oversize.length, 0);
});

test('reset clears buffered partial without emitting it', () => {
	const lines: string[] = [];
	const stream = createJsonlLineStream({ onLine: (line) => lines.push(line) });

	stream.feed('whoops');
	stream.reset();
	stream.feed('next\n');

	assert.deepEqual(lines, ['next']);
});

test('feed accepts Buffer chunks', () => {
	const lines: string[] = [];
	const stream = createJsonlLineStream({ onLine: (line) => lines.push(line) });

	stream.feed(Buffer.from('hello\n', 'utf8'));

	assert.deepEqual(lines, ['hello']);
});

test('reassembles a multibyte UTF-8 char split across Buffer chunks', () => {
	const lines: string[] = [];
	const stream = createJsonlLineStream({ onLine: (line) => lines.push(line) });

	// "😀" (U+1F600) is 4 bytes: F0 9F 98 80. Split the JSON line mid-emoji so
	// each Buffer holds an incomplete sequence — a naive per-chunk toString would
	// decode U+FFFD on both sides and corrupt the assistant text.
	const full = Buffer.from('{"text":"😀"}\n', 'utf8');
	const emojiStart = Buffer.from('{"text":"', 'utf8').length;
	stream.feed(full.subarray(0, emojiStart + 2));
	stream.feed(full.subarray(emojiStart + 2));

	assert.deepEqual(lines, ['{"text":"😀"}']);
	assert.equal(JSON.parse(lines[0] ?? '').text, '😀');
});

test('flushes a trailing partial multibyte char without a spurious replacement', () => {
	const lines: string[] = [];
	const stream = createJsonlLineStream({ onLine: (line) => lines.push(line) });

	const cjk = Buffer.from('日本語', 'utf8');
	stream.feed(cjk.subarray(0, 4));
	stream.feed(cjk.subarray(4));
	stream.flush();

	assert.deepEqual(lines, ['日本語']);
});

test('retains enough of a discarded line to carry a frame identity', () => {
	const oversize: Array<{ droppedBytes: number; firstBytes: string }> = [];
	const stream = createJsonlLineStream({
		maxLineBytes: 4096,
		onLine: () => undefined,
		onOversize: (info) => oversize.push(info),
	});

	const toolCallId = `call_${'x'.repeat(26)}|fc_${'0'.repeat(48)}`;
	const head = `{"type":"tool_execution_end","toolCallId":"${toolCallId}","toolName":"read","result":{"content":[{"type":"text","text":"`;
	stream.feed(head);
	stream.feed('A'.repeat(8192));
	stream.feed('"}]}}\nnext\n');

	const dropped = oversize[0];
	assert.ok(dropped);
	assert.ok(dropped.firstBytes.includes(`"toolCallId":"${toolCallId}"`));
});

test('bounds the retained prefix and never carries it into the next line', () => {
	const oversize: Array<{ droppedBytes: number; firstBytes: string }> = [];
	const stream = createJsonlLineStream({
		maxLineBytes: 4096,
		onLine: () => undefined,
		onOversize: (info) => oversize.push(info),
	});

	stream.feed(`{"first":"${'A'.repeat(8192)}"}\n`);
	stream.feed(`{"second":"${'B'.repeat(8192)}"}\n`);

	assert.equal(oversize.length, 2);
	for (const dropped of oversize) {
		assert.ok(dropped.firstBytes.length <= 1024);
	}
	assert.ok(oversize[0]?.firstBytes.startsWith('{"first":"'));
	assert.ok(oversize[1]?.firstBytes.startsWith('{"second":"'));
	assert.ok(!oversize[1]?.firstBytes.includes('A'));
});

test('counts buffered bytes without rescanning the accumulated line', () => {
	const oversize: Array<{ droppedBytes: number; firstBytes: string }> = [];
	const stream = createJsonlLineStream({
		maxLineBytes: 1024,
		onLine: () => undefined,
		onOversize: (info) => oversize.push(info),
	});

	for (let index = 0; index < 8; index += 1) {
		stream.feed('日'.repeat(64));
	}

	assert.equal(oversize.length, 1);
	assert.equal(oversize[0]?.droppedBytes, 6 * 64 * 3);
});
