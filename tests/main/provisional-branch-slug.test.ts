import { describe, expect, test } from 'vitest';

import { deriveProvisionalBranchSlug } from '../../src/main/agent-runtime/naming/provisional-branch-slug';

describe('deriveProvisionalBranchSlug', () => {
	test('slugs a direct instruction as written', () => {
		expect(deriveProvisionalBranchSlug('Add dark mode')).toBe('add-dark-mode');
	});

	// The reason this module exists rather than calling `sanitizeBranchSlug`
	// directly: a conversational prompt otherwise slugs its own preamble.
	test('drops the opening pleasantry before slugging', () => {
		expect(deriveProvisionalBranchSlug("I'd like to add dark mode")).toBe(
			'add-dark-mode',
		);
	});

	test('drops stacked openers', () => {
		expect(
			deriveProvisionalBranchSlug('ok so can you please add dark mode'),
		).toBe('add-dark-mode');
	});

	test('caps a long prompt at five meaningful words', () => {
		expect(
			deriveProvisionalBranchSlug(
				'I want to rework the tab and workspace naming mechanism when the app is in plan mode',
			),
		).toBe('rework-tab-workspace-naming-mechanism');
	});

	test('drops connective words that say nothing about the work', () => {
		expect(deriveProvisionalBranchSlug('convert this to TypeScript')).toBe(
			'convert-typescript',
		);
	});

	test('reads only the first line of a multi-line prompt', () => {
		expect(
			deriveProvisionalBranchSlug('Fix the login redirect\n\nSteps to repro:'),
		).toBe('fix-login-redirect');
	});

	test('takes the arguments of a slash command over its name', () => {
		expect(deriveProvisionalBranchSlug('/skill:tdd add dark mode')).toBe(
			'add-dark-mode',
		);
	});

	test('keeps a prompt made entirely of connective words rather than dropping it', () => {
		expect(deriveProvisionalBranchSlug('and to the')).toBe('and-to-the');
	});

	test('returns null when nothing usable remains', () => {
		expect(deriveProvisionalBranchSlug('')).toBeNull();
		expect(deriveProvisionalBranchSlug('   \n  ')).toBeNull();
		expect(deriveProvisionalBranchSlug('!!! ???')).toBeNull();
	});

	test('keeps a bare pleasantry from slugging to nothing', () => {
		expect(deriveProvisionalBranchSlug('please')).toBe('please');
	});

	test('leaves no entity fragment in a slug from an encoded prompt', () => {
		expect(deriveProvisionalBranchSlug('Admin &amp; Management')).toBe(
			'admin-management',
		);
		expect(deriveProvisionalBranchSlug('Compare &lt;div&gt; output')).toBe(
			'compare-div-output',
		);
		expect(deriveProvisionalBranchSlug('Quote the &quot;title&quot;')).toBe(
			'quote-title',
		);
		expect(deriveProvisionalBranchSlug('Admin &amp;amp; Management')).toBe(
			'admin-management',
		);
	});
});
