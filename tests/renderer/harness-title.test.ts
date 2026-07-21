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
	it('is busy when a leading braille spinner frame is present', () => {
		expect(isHarnessTitleBusy('⠋ Thinking')).toBe(true);
		expect(isHarnessTitleBusy('⠂ List first eight prime numbers')).toBe(true);
		expect(isHarnessTitleBusy('⠐ Claude Code')).toBe(true);
	});

	it('is idle for the ✳ sparkle, which a harness shows while waiting', () => {
		expect(isHarnessTitleBusy('✳ Claude Code')).toBe(false);
		expect(isHarnessTitleBusy('✳ List first eight prime numbers')).toBe(false);
	});

	it('is idle for a clean title', () => {
		expect(isHarnessTitleBusy('Claude Code')).toBe(false);
		expect(isHarnessTitleBusy('/repo/foo')).toBe(false);
	});

	it('ignores surrounding whitespace when deciding', () => {
		expect(isHarnessTitleBusy('  ⠋ Thinking  ')).toBe(true);
		expect(isHarnessTitleBusy('  Claude Code  ')).toBe(false);
	});
});
