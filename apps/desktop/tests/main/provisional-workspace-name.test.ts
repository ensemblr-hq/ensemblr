import { describe, expect, test } from 'vitest';

import { deriveProvisionalWorkspaceName } from '../../src/main/agent-runtime/naming/provisional-workspace-name';

describe('deriveProvisionalWorkspaceName', () => {
	test('takes a direct instruction as written', () => {
		expect(deriveProvisionalWorkspaceName('Add dark mode')).toBe(
			'Add dark mode',
		);
	});

	// The reason this module exists rather than calling `sanitizeBranchSlug`
	// directly: a conversational prompt otherwise names itself after its preamble.
	test('drops the opening pleasantry', () => {
		expect(deriveProvisionalWorkspaceName("I'd like to add dark mode")).toBe(
			'add dark mode',
		);
	});

	test('drops stacked openers', () => {
		expect(
			deriveProvisionalWorkspaceName('ok so can you please add dark mode'),
		).toBe('add dark mode');
	});

	test('caps a long prompt at five meaningful words', () => {
		expect(
			deriveProvisionalWorkspaceName(
				'I want to rework the tab and workspace naming mechanism when the app is in plan mode',
			),
		).toBe('rework tab workspace naming mechanism');
	});

	test('drops connective words that say nothing about the work', () => {
		expect(deriveProvisionalWorkspaceName('convert this to TypeScript')).toBe(
			'convert TypeScript',
		);
	});

	// The whole reason it yields a phrase rather than a slug: a name recovered
	// from a lowercased slug cannot tell "IPC" from "ipc".
	test('keeps the capitalization the user typed', () => {
		expect(deriveProvisionalWorkspaceName('fix the IPC handler')).toBe(
			'fix IPC handler',
		);
		expect(deriveProvisionalWorkspaceName('rework GitHub PR sweeping')).toBe(
			'rework GitHub PR sweeping',
		);
	});

	test('reads only the first line of a multi-line prompt', () => {
		expect(
			deriveProvisionalWorkspaceName(
				'Fix the login redirect\n\nSteps to repro:',
			),
		).toBe('Fix login redirect');
	});

	test('takes the arguments of a slash command over its name', () => {
		expect(deriveProvisionalWorkspaceName('/skill:tdd add dark mode')).toBe(
			'add dark mode',
		);
	});

	test('keeps a prompt made entirely of connective words rather than dropping it', () => {
		expect(deriveProvisionalWorkspaceName('and to the')).toBe('and to the');
	});

	test('returns null when nothing usable remains', () => {
		expect(deriveProvisionalWorkspaceName('')).toBeNull();
		expect(deriveProvisionalWorkspaceName('   \n  ')).toBeNull();
		expect(deriveProvisionalWorkspaceName('!!! ???')).toBeNull();
	});

	test('keeps a bare pleasantry from reducing to nothing', () => {
		expect(deriveProvisionalWorkspaceName('please')).toBe('please');
	});

	test('leaves no entity fragment in a name from an encoded prompt', () => {
		expect(deriveProvisionalWorkspaceName('Admin &amp; Management')).toBe(
			'Admin Management',
		);
		expect(deriveProvisionalWorkspaceName('Compare &lt;div&gt; output')).toBe(
			'Compare div output',
		);
		expect(deriveProvisionalWorkspaceName('Quote the &quot;title&quot;')).toBe(
			'Quote title',
		);
		expect(deriveProvisionalWorkspaceName('Admin &amp;amp; Management')).toBe(
			'Admin Management',
		);
	});
});
