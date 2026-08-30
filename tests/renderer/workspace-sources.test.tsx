import { expect, test } from 'vitest';
import {
	getWorkspaceSourceActions,
	getWorkspaceSourceKindLabel,
	getWorkspaceSourceProviderLabel,
	WORKSPACE_SOURCE_KINDS,
} from '../../src/renderer/lib/workbench';
import type { WorkspaceSource } from '../../src/renderer/types/workbench';

test('orders kinds as pull requests, branches, then issues', () => {
	expect(WORKSPACE_SOURCE_KINDS).toEqual(['pull-request', 'branch', 'issue']);
});

test('labels each source kind for the segmented filter', () => {
	expect(getWorkspaceSourceKindLabel('pull-request')).toBe('Pull requests');
	expect(getWorkspaceSourceKindLabel('branch')).toBe('Branches');
	expect(getWorkspaceSourceKindLabel('issue')).toBe('Issues');
});

test('provides row actions per source', () => {
	const pullRequest: WorkspaceSource = {
		id: 'p1',
		kind: 'pull-request',
		provider: 'github',
		title: 'PR',
	};
	const issue: WorkspaceSource = {
		id: 'i1',
		kind: 'issue',
		provider: 'linear',
		title: 'ENG-1',
	};
	const branchWithWorkspace: WorkspaceSource = {
		hasWorkspace: true,
		id: 'b1',
		kind: 'branch',
		provider: 'github',
		title: 'feature',
	};
	const branchWithoutWorkspace: WorkspaceSource = {
		id: 'b2',
		kind: 'branch',
		provider: 'github',
		title: 'master',
	};
	// A free pull-request head is taken over, not cut, so it reads the same as a
	// free branch. Only an issue, which has no branch at all, creates one.
	expect(getWorkspaceSourceActions(pullRequest).map((a) => a.label)).toEqual([
		'Use branch',
	]);
	expect(getWorkspaceSourceActions(issue).map((a) => a.label)).toEqual([
		'Create',
	]);
	expect(
		getWorkspaceSourceActions(branchWithWorkspace).map((a) => a.label),
	).toEqual(['Open', 'Duplicate branch']);
	// The shortcut is formatted for the running platform, and this suite runs on
	// both CI legs — a bare '⌘↵' asserts the macOS spelling against a Linux runner.
	expect(getWorkspaceSourceActions(branchWithWorkspace)[1]?.shortcut).toBe(
		process.platform === 'darwin' ? '⌘↵' : 'Ctrl+Enter',
	);
	expect(
		getWorkspaceSourceActions(branchWithoutWorkspace).map((a) => a.label),
	).toEqual(['Use branch']);
});

test('labels each provider', () => {
	expect(getWorkspaceSourceProviderLabel('github')).toBe('GitHub');
	expect(getWorkspaceSourceProviderLabel('linear')).toBe('Linear');
});
