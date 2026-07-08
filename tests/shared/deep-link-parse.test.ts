import { describe, expect, test } from 'vitest';

import { isAllowedExternalUrl, parseDeepLink } from '@/shared/deep-link/parse';

describe('parseDeepLink', () => {
	test('parses workbench root', () => {
		expect(parseDeepLink('ensemble://workbench')).toEqual({
			kind: 'workbench',
		});
	});

	test('parses repo', () => {
		expect(parseDeepLink('ensemble://repo/abc123')).toEqual({
			kind: 'repo',
			repositoryId: 'abc123',
		});
	});

	test('parses repo settings section', () => {
		expect(parseDeepLink('ensemble://repo/r1/settings/scripts')).toEqual({
			kind: 'repo-settings',
			repositoryId: 'r1',
			section: 'scripts',
		});
	});

	test('rejects unknown repo section', () => {
		const result = parseDeepLink('ensemble://repo/r1/settings/explode');
		expect(result.kind).toBe('invalid');
	});

	test('parses workspace + chat', () => {
		expect(parseDeepLink('ensemble://workspace/repo1/ws1/chat/c1')).toEqual({
			chatId: 'c1',
			kind: 'workspace-chat',
			repositoryId: 'repo1',
			workspaceId: 'ws1',
		});
	});

	test('parses linear issue', () => {
		expect(parseDeepLink('ensemble://linear/THE-161')).toEqual({
			kind: 'linear-issue',
			issueId: 'THE-161',
		});
	});

	test('rejects path traversal', () => {
		const result = parseDeepLink('ensemble://repo/..%2F..%2Fetc%2Fpasswd');
		expect(result.kind).toBe('invalid');
	});

	test('rejects unsupported protocol', () => {
		const result = parseDeepLink('file:///etc/passwd');
		expect(result.kind).toBe('invalid');
		if (result.kind === 'invalid') {
			expect(result.reason).toBe('unsupported-protocol');
		}
	});
});

describe('isAllowedExternalUrl', () => {
	test('allows github', () => {
		expect(isAllowedExternalUrl('https://github.com/x/y/pull/1')).toBe(true);
	});
	test('allows linear', () => {
		expect(isAllowedExternalUrl('https://linear.app/x/issue/THE-1')).toBe(true);
	});
	test('allows localhost', () => {
		expect(isAllowedExternalUrl('http://localhost:3000')).toBe(true);
	});
	test('rejects file://', () => {
		expect(isAllowedExternalUrl('file:///etc/passwd')).toBe(false);
	});
	test('rejects unknown host', () => {
		expect(isAllowedExternalUrl('https://evil.example.com')).toBe(false);
	});
});
