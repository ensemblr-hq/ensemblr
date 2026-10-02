import { describe, expect, test } from 'vitest';

import {
	buildGithubCompareUrl,
	parseGithubRepoFromRemoteUrl,
} from '../../src/renderer/lib/workbench/github-compare-url';

describe('parseGithubRepoFromRemoteUrl', () => {
	test('parses HTTPS remotes with and without .git', () => {
		expect(
			parseGithubRepoFromRemoteUrl(
				'https://github.com/ensemblr-hq/ensemblr.git',
			),
		).toEqual({ owner: 'ensemblr-hq', repo: 'ensemblr' });
		expect(
			parseGithubRepoFromRemoteUrl('https://github.com/ensemblr-hq/ensemblr'),
		).toEqual({ owner: 'ensemblr-hq', repo: 'ensemblr' });
	});

	test('parses a trailing slash', () => {
		expect(
			parseGithubRepoFromRemoteUrl('https://github.com/ensemblr-hq/ensemblr/'),
		).toEqual({ owner: 'ensemblr-hq', repo: 'ensemblr' });
	});

	test('parses git@ and ssh:// remotes', () => {
		expect(
			parseGithubRepoFromRemoteUrl('git@github.com:ensemblr-hq/ensemblr.git'),
		).toEqual({ owner: 'ensemblr-hq', repo: 'ensemblr' });
		expect(
			parseGithubRepoFromRemoteUrl(
				'ssh://git@github.com/ensemblr-hq/ensemblr.git',
			),
		).toEqual({ owner: 'ensemblr-hq', repo: 'ensemblr' });
	});

	test('keeps dots inside the repo name', () => {
		expect(
			parseGithubRepoFromRemoteUrl('https://github.com/acme/my.repo'),
		).toEqual({ owner: 'acme', repo: 'my.repo' });
	});

	test('returns null for non-github hosts and empty input', () => {
		expect(
			parseGithubRepoFromRemoteUrl(
				'https://gitlab.com/ensemblr-hq/ensemblr.git',
			),
		).toBeNull();
		expect(parseGithubRepoFromRemoteUrl(null)).toBeNull();
		expect(parseGithubRepoFromRemoteUrl(undefined)).toBeNull();
		expect(parseGithubRepoFromRemoteUrl('')).toBeNull();
	});
});

describe('buildGithubCompareUrl', () => {
	test('URL-encodes the head branch and keeps the base when known', () => {
		expect(
			buildGithubCompareUrl({
				base: 'master',
				head: 'octocat/checks-panel-pr-inputs',
				owner: 'ensemblr-hq',
				repo: 'ensemblr',
			}),
		).toBe(
			'https://github.com/ensemblr-hq/ensemblr/compare/master...octocat%2Fchecks-panel-pr-inputs?body=&expand=1',
		);
	});

	test('omits the base range when base is missing', () => {
		expect(
			buildGithubCompareUrl({
				head: 'feature/x',
				owner: 'ensemblr-hq',
				repo: 'ensemblr',
			}),
		).toBe(
			'https://github.com/ensemblr-hq/ensemblr/compare/feature%2Fx?body=&expand=1',
		);
	});
});
