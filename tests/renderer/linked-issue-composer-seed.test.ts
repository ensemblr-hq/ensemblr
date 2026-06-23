import { expect, test } from 'bun:test';

import { formatLinkedIssueComposerSeed } from '../../src/renderer/lib/workbench/linked-issue-composer-seed.ts';

test('includes the heading, full body, and link', () => {
	const seed = formatLinkedIssueComposerSeed({
		description: 'Steps to reproduce:\n1. open\n2. crash',
		reference: '#44',
		title: 'Dedup recents',
		url: 'https://github.com/o/r/issues/44',
	});

	expect(seed).toBe(
		'#44 Dedup recents\n\nSteps to reproduce:\n1. open\n2. crash\n\nhttps://github.com/o/r/issues/44',
	);
});

test('omits the body block when there is no description', () => {
	const seed = formatLinkedIssueComposerSeed({
		reference: 'THE-1',
		title: 'Wire the picker',
		url: 'https://linear.app/the/issue/THE-1',
	});

	expect(seed).toBe(
		'THE-1 Wire the picker\n\nhttps://linear.app/the/issue/THE-1',
	);
});

test('omits the link when there is no url', () => {
	const seed = formatLinkedIssueComposerSeed({
		description: 'Body only.',
		reference: '#7',
		title: 'Local issue',
	});

	expect(seed).toBe('#7 Local issue\n\nBody only.');
});

test('truncates a pathologically long body with an ellipsis', () => {
	const seed = formatLinkedIssueComposerSeed({
		description: 'x'.repeat(10_000),
		reference: '#7',
		title: 'Huge',
	});

	expect(seed.endsWith('…')).toBe(true);
	// Heading + 8000-char body cap + ellipsis — nowhere near the 10k input.
	expect(seed.length).toBeLessThan(8100);
});
