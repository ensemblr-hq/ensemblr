import { describe, expect, test } from 'vitest';

import {
	buildCoAuthorTrailers,
	ENSEMBLR_CO_AUTHOR_EMAIL,
	ENSEMBLR_CO_AUTHOR_NAME,
	ENSEMBLR_CO_AUTHOR_TRAILER,
} from '../../src/shared/co-author';

describe('ENSEMBLR_CO_AUTHOR_TRAILER', () => {
	test('is the git trailer GitHub matches, composed from the two constants', () => {
		expect(ENSEMBLR_CO_AUTHOR_TRAILER).toBe(
			`Co-authored-by: ${ENSEMBLR_CO_AUTHOR_NAME} <${ENSEMBLR_CO_AUTHOR_EMAIL}>`,
		);
	});

	test('credits the ensemblr-dev user account', () => {
		expect(ENSEMBLR_CO_AUTHOR_EMAIL).toBe('howdy@ensemblr.dev');
		expect(ENSEMBLR_CO_AUTHOR_NAME).toBe('Ensemblr');
	});

	test('is a single line, which is what makes the credit land', () => {
		expect(ENSEMBLR_CO_AUTHOR_TRAILER).not.toContain('\n');
	});
});

describe('buildCoAuthorTrailers', () => {
	test('yields nothing while the credit is off', () => {
		expect(buildCoAuthorTrailers(false)).toEqual([]);
	});

	test('yields the one trailer while the credit is on', () => {
		expect(buildCoAuthorTrailers(true)).toEqual([ENSEMBLR_CO_AUTHOR_TRAILER]);
	});
});
