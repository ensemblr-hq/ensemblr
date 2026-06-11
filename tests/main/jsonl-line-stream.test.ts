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
