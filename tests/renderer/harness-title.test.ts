import { describe, expect, it } from 'vitest';
import {
	isHarnessTitleBusy,
	stripHarnessTitleDecoration,
} from '@/renderer/lib/terminal/harness-title';

describe('stripHarnessTitleDecoration', () => {
	it('removes a leading spinner/symbol glyph and surrounding whitespace', () => {
		expect(stripHarnessTitleDecoration('✳ Claude Code')).toBe('Claude Code');
	});

	it('removes a leading braille spinner frame', () => {
		expect(stripHarnessTitleDecoration('⠋ Working on it')).toBe(
			'Working on it',
		);
	});

	it('keeps a clean title untouched', () => {
		expect(stripHarnessTitleDecoration('Fix login bug')).toBe('Fix login bug');
	});

	it('preserves leading punctuation such as a path separator', () => {
		expect(stripHarnessTitleDecoration('/repo/foo')).toBe('/repo/foo');
	});

	it('returns an empty string for pure decoration', () => {
		expect(stripHarnessTitleDecoration('✳  ')).toBe('');
	});
});

describe('isHarnessTitleBusy', () => {
	it('is busy when a leading spinner glyph is present', () => {
		expect(isHarnessTitleBusy('✳ Claude Code')).toBe(true);
		expect(isHarnessTitleBusy('⠋ Thinking')).toBe(true);
	});

	it('is idle for a clean title', () => {
		expect(isHarnessTitleBusy('Claude Code')).toBe(false);
		expect(isHarnessTitleBusy('/repo/foo')).toBe(false);
	});

	it('ignores surrounding whitespace when deciding', () => {
		expect(isHarnessTitleBusy('  Claude Code  ')).toBe(false);
	});
});
