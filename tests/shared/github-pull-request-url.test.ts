import { describe, expect, test } from 'vitest';

import {
	containsPullRequestUrl,
	extractPullRequestNumber,
	extractPullRequestUrl,
	mentionsGhPrCreate,
} from '../../src/shared/github';

describe('extractPullRequestUrl', () => {
	test('pulls a PR URL out of gh pr create stdout', () => {
		expect(
			extractPullRequestUrl(
				'Creating pull request...\nhttps://github.com/acme/app/pull/42\n',
			),
		).toBe('https://github.com/acme/app/pull/42');
	});

	test('matches a URL embedded in JSON-serialized output', () => {
		expect(
			extractPullRequestUrl('{"url":"https://github.com/acme/app/pull/7"}'),
		).toBe('https://github.com/acme/app/pull/7');
	});

	test('returns undefined when there is no PR URL', () => {
		expect(extractPullRequestUrl('nothing to see here')).toBeUndefined();
	});
});

describe('extractPullRequestNumber', () => {
	test('reads the number from a PR URL', () => {
		expect(
			extractPullRequestNumber('https://github.com/acme/app/pull/128'),
		).toBe(128);
	});

	test('returns undefined without a number', () => {
		expect(
			extractPullRequestNumber('https://github.com/acme/app/pulls'),
		).toBeUndefined();
	});
});

describe('mentionsGhPrCreate', () => {
	test('matches a gh pr create invocation', () => {
		expect(mentionsGhPrCreate('gh pr create --fill --base main')).toBe(true);
	});

	test('matches gh pr create with extra whitespace', () => {
		expect(mentionsGhPrCreate('gh   pr   create')).toBe(true);
	});

	test('does not match unrelated gh usage', () => {
		expect(mentionsGhPrCreate('gh pr view --json state')).toBe(false);
	});

	test('does not treat a bare PR URL as a create command', () => {
		expect(
			mentionsGhPrCreate('gh pr view https://github.com/acme/app/pull/9'),
		).toBe(false);
	});
});

describe('containsPullRequestUrl', () => {
	test('matches output carrying a PR URL', () => {
		expect(
			containsPullRequestUrl('opened https://github.com/acme/app/pull/9'),
		).toBe(true);
	});

	test('does not match output without a PR URL', () => {
		expect(containsPullRequestUrl('nothing here')).toBe(false);
	});
});
