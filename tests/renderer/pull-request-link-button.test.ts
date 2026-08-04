import { expect, test } from 'vitest';

import {
	getPullRequestLinkButtonClassName,
	resolvePreviewPillTone,
} from '@/renderer/lib/workbench/pull-request-link-button';
import type { PullRequestHeaderTone } from '@/renderer/types/workbench';

const HEADER_TONES: PullRequestHeaderTone[] = [
	'blocked',
	'merged',
	'neutral',
	'pending',
	'ready',
];

test.each(
	HEADER_TONES,
)('a ready deployment defers to the %s header tone', (headerTone) => {
	expect(resolvePreviewPillTone(headerTone, 'ready')).toBe(headerTone);
});

test.each(
	HEADER_TONES,
)('a still-building deployment outranks the %s header tone', (headerTone) => {
	expect(resolvePreviewPillTone(headerTone, 'pending')).toBe('pending');
});

test.each(
	HEADER_TONES,
)('a failed deployment outranks the %s header tone', (headerTone) => {
	expect(resolvePreviewPillTone(headerTone, 'blocked')).toBe('blocked');
});

test('every header tone maps to a distinct pill class string', () => {
	const classNames = HEADER_TONES.map((tone) =>
		getPullRequestLinkButtonClassName(tone),
	);

	expect(new Set(classNames).size).toBe(HEADER_TONES.length);
});
