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

test.each(HEADER_TONES)(
	'a ready deployment defers to the %s header tone',
	(headerTone) => {
		expect(resolvePreviewPillTone(headerTone, 'ready')).toBe(headerTone);
	},
);

test.each(HEADER_TONES)(
	'a still-building deployment outranks the %s header tone',
	(headerTone) => {
		expect(resolvePreviewPillTone(headerTone, 'pending')).toBe('pending');
	},
);

test.each(HEADER_TONES)(
	'a failed deployment outranks the %s header tone',
	(headerTone) => {
		expect(resolvePreviewPillTone(headerTone, 'blocked')).toBe('blocked');
	},
);

const TINTED_TONES: PullRequestHeaderTone[] = [
	'blocked',
	'merged',
	'pending',
	'ready',
];

// `variant='outline'` carries `dark:border-input`, which outranks an unprefixed
// border class on specificity — so each tinted tone has to repeat its own border
// under `dark:`, at the same colour and alpha, or dark mode goes neutral.
const TINTED_BORDER = /(?:^|\s)(border-(?!input)[\w-]+\/\d+)/;

test.each(TINTED_TONES)('the %s pill repeats its border under dark', (tone) => {
	const className = getPullRequestLinkButtonClassName(tone);
	const lightBorder = className.match(TINTED_BORDER)?.[1];

	expect(lightBorder).toBeDefined();
	expect(className).toContain(`dark:${lightBorder}`);
});

test('every header tone maps to a distinct pill class string', () => {
	const classNames = HEADER_TONES.map((tone) =>
		getPullRequestLinkButtonClassName(tone),
	);

	expect(new Set(classNames).size).toBe(HEADER_TONES.length);
});
