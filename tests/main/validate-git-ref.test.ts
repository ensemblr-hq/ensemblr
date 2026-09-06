import { describe, expect, it } from 'vitest';

import {
	GIT_REF_MAX_LENGTH,
	validateGitRef,
} from '../../src/main/repository/validate-git-ref';

describe('validateGitRef', () => {
	it('accepts a bare branch name', () => {
		expect(validateGitRef('master')).toBeNull();
	});

	it('accepts a remote-qualified ref', () => {
		expect(validateGitRef('origin/release/2026')).toBeNull();
	});

	it('rejects an empty ref', () => {
		expect(validateGitRef('')?.reason).toBe('empty');
	});

	it('rejects a ref past the length budget', () => {
		expect(validateGitRef('a'.repeat(GIT_REF_MAX_LENGTH))).toBeNull();
		expect(validateGitRef('a'.repeat(GIT_REF_MAX_LENGTH + 1))?.reason).toBe(
			'too-long',
		);
	});

	it('rejects whitespace and range syntax', () => {
		expect(validateGitRef('my branch')?.reason).toBe('invalid-chars');
		expect(validateGitRef('master..feature')?.reason).toBe('invalid-chars');
	});

	it('rejects a colon, which git reads as a writing refspec', () => {
		// `ensureBaseRefAvailable` passes the tail to `git fetch origin <tail>`,
		// where `+main:refs/heads/master` force-updates a local branch, and the
		// leading segment of `git@host:a/b` is read as an scp-style URL.
		expect(validateGitRef('origin/main:refs/heads/pwned')?.reason).toBe(
			'invalid-chars',
		);
		expect(validateGitRef('origin/+main:refs/heads/master')?.reason).toBe(
			'invalid-chars',
		);
		expect(validateGitRef('git@evil.example:a/b.git/main')?.reason).toBe(
			'invalid-chars',
		);
	});

	it('rejects revision and glob syntax git-check-ref-format forbids', () => {
		for (const ref of [
			'origin/main~1',
			'origin/main^2',
			'origin/rele?se',
			'origin/*',
			'origin/[abc]',
			'origin/back\\slash',
		]) {
			expect(validateGitRef(ref)?.reason).toBe('invalid-chars');
		}
	});

	it('rejects a leading dash on the whole ref', () => {
		expect(validateGitRef('--upload-pack=/tmp/x')?.reason).toBe(
			'invalid-chars',
		);
	});

	it('rejects a leading dash on any segment, not just the first', () => {
		expect(validateGitRef('origin/--upload-pack=/tmp/x')?.reason).toBe(
			'invalid-chars',
		);
		expect(validateGitRef('origin/feature/-x')?.reason).toBe('invalid-chars');
	});

	it('leaves a dash inside a segment alone', () => {
		expect(validateGitRef('origin/my-feature-branch')).toBeNull();
	});
});
