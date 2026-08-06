import { describe, expect, it } from 'vitest';
import { buildGithubCompareUrl } from '@/renderer/lib/workbench/github-compare-url';
import { bareBranchName, originQualifiedRef } from '@/shared/branch-ref';

describe('bareBranchName', () => {
	it('strips the origin qualifier', () => {
		expect(bareBranchName('origin/master')).toBe('master');
		expect(bareBranchName('refs/remotes/origin/master')).toBe('master');
	});

	it('leaves an already-bare name alone', () => {
		expect(bareBranchName('master')).toBe('master');
		expect(bareBranchName('psoldunov/feature-x')).toBe('psoldunov/feature-x');
	});

	it('only strips a leading qualifier', () => {
		expect(bareBranchName('feature/origin/thing')).toBe('feature/origin/thing');
	});

	it('returns null for absent or blank refs', () => {
		expect(bareBranchName(null)).toBeNull();
		expect(bareBranchName(undefined)).toBeNull();
		expect(bareBranchName('   ')).toBeNull();
		expect(bareBranchName('origin/')).toBeNull();
	});
});

describe('originQualifiedRef', () => {
	it('qualifies a bare name', () => {
		expect(originQualifiedRef('master')).toBe('origin/master');
	});

	it('does not double-qualify an already-qualified ref', () => {
		expect(originQualifiedRef('origin/master')).toBe('origin/master');
	});

	it('returns null for absent refs', () => {
		expect(originQualifiedRef(null)).toBeNull();
		expect(originQualifiedRef('')).toBeNull();
	});
});

describe('buildGithubCompareUrl', () => {
	it('compares against the bare base, not the remote-qualified ref', () => {
		expect(
			buildGithubCompareUrl({
				base: 'origin/master',
				head: 'feature',
				owner: 'acme',
				repo: 'app',
			}),
		).toBe(
			'https://github.com/acme/app/compare/master...feature?body=&expand=1',
		);
	});

	it('still encodes slashes inside branch names', () => {
		expect(
			buildGithubCompareUrl({
				base: 'origin/release/2026',
				head: 'user/feature',
				owner: 'acme',
				repo: 'app',
			}),
		).toBe(
			'https://github.com/acme/app/compare/release%2F2026...user%2Ffeature?body=&expand=1',
		);
	});

	it('omits the base when none is known', () => {
		expect(
			buildGithubCompareUrl({
				base: null,
				head: 'feature',
				owner: 'a',
				repo: 'b',
			}),
		).toBe('https://github.com/a/b/compare/feature?body=&expand=1');
	});
});
