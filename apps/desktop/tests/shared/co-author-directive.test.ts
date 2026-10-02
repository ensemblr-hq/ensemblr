import { describe, expect, test } from 'vitest';

import {
	buildCoAuthorDirective,
	CO_AUTHOR_DIRECTIVE_HEADER,
} from '../../src/shared/agent-control';
import { ENSEMBLR_CO_AUTHOR_TRAILER } from '../../src/shared/co-author';

describe('buildCoAuthorDirective', () => {
	test('says nothing while the credit is off', () => {
		expect(buildCoAuthorDirective(false)).toBeNull();
	});

	test('opens with the header a playbook is searched for', () => {
		expect(
			buildCoAuthorDirective(true)?.startsWith(CO_AUTHOR_DIRECTIVE_HEADER),
		).toBe(true);
	});

	test('carries the trailer verbatim, so the agent copies rather than composes', () => {
		expect(buildCoAuthorDirective(true)).toContain(ENSEMBLR_CO_AUTHOR_TRAILER);
	});

	test('tells the agent not to write the trailer twice', () => {
		expect(buildCoAuthorDirective(true)).toContain('never write it twice');
	});
});
