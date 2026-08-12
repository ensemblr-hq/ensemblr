import { describe, expect, it } from 'vitest';

import { toReadableScrollback } from '../../src/main/terminal/scrollback-text.ts';

const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);
const BS = String.fromCharCode(8);

// An agent reading a dev server's scrollback wanted one line — the Local URL —
// and got it wrapped in colour codes, a cursor-home-and-erase repaint, and a
// dozen blank lines. Everything here is a shape that read really produced.
describe('toReadableScrollback', () => {
	it('drops colour codes and keeps the text they wrapped', () => {
		expect(
			toReadableScrollback(
				`${ESC}[32m➜${ESC}[39m  Local: http://localhost:5199/`,
			),
		).toBe('➜  Local: http://localhost:5199/');
	});

	it('drops a full-screen repaint and collapses the blank run it leaves', () => {
		expect(
			toReadableScrollback(
				`${ESC}[1;1H${ESC}[0J\r\n\r\n\r\n\r\nVITE ready\r\n\r\n\r\n\r\ndone\r\n`,
			),
		).toBe('VITE ready\n\ndone');
	});

	it('keeps only what a carriage return left painted on the line', () => {
		expect(
			toReadableScrollback('downloading  10%\rdownloading  99%\rdone\r\n'),
		).toBe('done');
	});

	it('drops an OSC title sequence without eating the line after it', () => {
		expect(toReadableScrollback(`${ESC}]0;playground${BEL}ready`)).toBe(
			'ready',
		);
	});

	// npm, pip, cargo and docker walk a percentage back with backspaces rather
	// than a carriage return. Dropping them left both the covered text and the
	// text that covered it: `100%done` for what a terminal shows as `done`.
	it('walks the cursor back over what a backspace covered', () => {
		expect(toReadableScrollback(`100%${BS.repeat(4)}done`)).toBe('done');
	});

	it('resolves the backspace-space-backspace a spinner erases with', () => {
		expect(toReadableScrollback(`x${BS} ${BS}`)).toBe('');
	});

	it('counts a backspace in characters, not code units', () => {
		expect(toReadableScrollback(`🙂🙂${BS}🚀`)).toBe('🙂🚀');
	});

	it('leaves the line alone when a backspace only moves the cursor', () => {
		expect(toReadableScrollback(`abc${BS}`)).toBe('abc');
	});

	it('resolves backspaces per line rather than across the buffer', () => {
		expect(toReadableScrollback(`a\r\n100%${BS.repeat(4)}done\r\nb`)).toBe(
			'a\ndone\nb',
		);
	});

	// The read lands between PTY writes, so the tail of the buffer is routinely a
	// sequence with its parameters but not yet the byte that ends it. Left in, the
	// two-character escape pass ate the `ESC [` and published the parameters as
	// text an agent cannot tell from real output.
	it('drops a sequence the read caught before its final byte', () => {
		expect(toReadableScrollback(`ok${ESC}[38;2;255`)).toBe('ok');
	});

	it('drops a string command left unterminated at the end of the buffer', () => {
		expect(toReadableScrollback(`ok${ESC}Pq`)).toBe('ok');
	});

	it('leaves plain output untouched apart from its line endings', () => {
		expect(toReadableScrollback('one\r\ntwo\r\nthree')).toBe('one\ntwo\nthree');
	});

	it('renders a buffer of nothing but escapes as empty', () => {
		expect(toReadableScrollback(`${ESC}[2J${ESC}[H\r\n\r\n`)).toBe('');
	});
});
