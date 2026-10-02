import { expect, test } from 'vitest';

import { formatLinkedIssueComposerSeed } from '../../src/renderer/lib/workbench/linked-issue-composer-seed.ts';

test('seeds the draft with the issue headline', () => {
	const seed = formatLinkedIssueComposerSeed({
		reference: '#44',
		title: 'Dedup recents',
	});

	expect(seed).toBe('#44 Dedup recents');
});

// The body and the link live in the attachment chip's document now. Pasting them
// here too would hand the agent the same text twice and leave the only complete
// copy inside a textbox the user can clear before sending.
test('carries neither the body nor the link, which the attachment holds', () => {
	const seed = formatLinkedIssueComposerSeed({
		reference: 'ENG-1',
		title: 'Wire the picker',
	});

	expect(seed).toBe('ENG-1 Wire the picker');
	expect(seed).not.toContain('\n');
});

test('trims a headline whose title is empty', () => {
	expect(formatLinkedIssueComposerSeed({ reference: '#7', title: '' })).toBe(
		'#7',
	);
});
