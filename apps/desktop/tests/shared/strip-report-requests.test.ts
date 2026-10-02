import { describe, expect, test } from 'vitest';

import { stripReportRequests } from '../../src/shared/terminal/strip-report-requests';

/** Control bytes built at runtime to avoid literal control characters in source. */
const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);
const ST = `${ESC}\\`;

describe('stripReportRequests', () => {
	test('removes Device Attributes queries (CSI c)', () => {
		expect(stripReportRequests(`a${ESC}[cb`)).toBe('ab');
		expect(stripReportRequests(`${ESC}[0c`)).toBe('');
		expect(stripReportRequests(`${ESC}[>c`)).toBe('');
		expect(stripReportRequests(`${ESC}[>0c`)).toBe('');
		expect(stripReportRequests(`${ESC}[=c`)).toBe('');
	});

	test('removes Device Status Report and cursor-position requests (CSI n)', () => {
		expect(stripReportRequests(`${ESC}[5n`)).toBe('');
		expect(stripReportRequests(`${ESC}[6n`)).toBe('');
		expect(stripReportRequests(`${ESC}[?6n`)).toBe('');
	});

	test('removes DECRQM, XTVERSION and Kitty keyboard queries', () => {
		expect(stripReportRequests(`${ESC}[?2026$p`)).toBe('');
		expect(stripReportRequests(`${ESC}[>0q`)).toBe('');
		expect(stripReportRequests(`${ESC}[?u`)).toBe('');
	});

	test('removes window-op size/position report requests (CSI 11–21 t)', () => {
		expect(stripReportRequests(`${ESC}[14t`)).toBe('');
		expect(stripReportRequests(`${ESC}[16t`)).toBe('');
		expect(stripReportRequests(`${ESC}[18t`)).toBe('');
	});

	test('removes dynamic-color queries but keeps color set sequences', () => {
		expect(stripReportRequests(`${ESC}]11;?${ST}`)).toBe('');
		expect(stripReportRequests(`${ESC}]10;?${BEL}`)).toBe('');
		expect(stripReportRequests(`${ESC}]4;1;?${ST}`)).toBe('');
		const setBg = `${ESC}]11;rgb:1212/0e0e/0d0d${ST}`;
		expect(stripReportRequests(setBg)).toBe(setBg);
	});

	test('removes chained and batched dynamic-color queries', () => {
		expect(stripReportRequests(`${ESC}]10;?;?${ST}`)).toBe('');
		expect(stripReportRequests(`${ESC}]4;1;?;2;?${ST}`)).toBe('');
		expect(stripReportRequests(`x${ESC}]4;1;?;2;?;3;?${BEL}y`)).toBe('xy');
	});

	test('removes DECRQSS/XTGETTCAP but leaves sixel data intact', () => {
		expect(stripReportRequests(`${ESC}P$qm${ST}`)).toBe('');
		expect(stripReportRequests(`${ESC}P+q544e${ST}`)).toBe('');
		const sixel = `${ESC}Pq#0;2;0;0;0#0~~@@vv@@~~${ST}`;
		expect(stripReportRequests(sixel)).toBe(sixel);
	});

	test('keeps window titles that legitimately end in a question mark', () => {
		const title = `${ESC}]0;Ready?${BEL}`;
		expect(stripReportRequests(title)).toBe(title);
	});

	test('leaves ordinary text, colors, and cursor movement untouched', () => {
		const text = `${ESC}[38;2;255;0;0mhello${ESC}[0m\r\n${ESC}[2Aworld`;
		expect(stripReportRequests(text)).toBe(text);
	});

	test('strips the interleaved queries fastfetch emits from a scrollback replay', () => {
		const captured = `banner${ESC}]11;?${ST}${ESC}[c${ESC}[6nmore`;
		expect(stripReportRequests(captured)).toBe('bannermore');
	});
});
