/**
 * `cn` merges through tailwind-merge, which classifies any `text-*` class it
 * cannot read as a size into the text-colour group. The repo's own `--text-*`
 * scales fell into that trap: a tint applied after the size silently removed the
 * size, so labels rendered at whatever font-size they inherited.
 */

import { describe, expect, test } from 'vitest';

import { cn } from '../../src/renderer/lib/utils';

describe('cn keeps the repo font-size scales out of the colour group', () => {
	test('a tint after a custom size leaves the size in place', () => {
		expect(cn('shrink-0 text-xxs', 'text-status-warning')).toBe(
			'shrink-0 text-xxs text-status-warning',
		);
		expect(cn('text-code-body', 'text-foreground')).toBe(
			'text-code-body text-foreground',
		);
	});

	test('a custom size still overrides a Tailwind one, and vice versa', () => {
		expect(cn('text-sm', 'text-xxs')).toBe('text-xxs');
		expect(cn('text-xxs', 'text-sm')).toBe('text-sm');
	});

	test('tints still override each other', () => {
		expect(cn('text-status-warning text-xxs', 'text-accent-strong')).toBe(
			'text-xxs text-accent-strong',
		);
	});
});
