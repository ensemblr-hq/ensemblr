import { expect, test } from 'bun:test';
import { defaultWorkspaceSources } from '../../src/renderer/fixtures/workbench';
import {
	filterWorkspaceSourcesByKind,
	getWorkspaceSourceActions,
	getWorkspaceSourceKindLabel,
	getWorkspaceSourceProviderLabel,
	WORKSPACE_SOURCE_KINDS,
} from '../../src/renderer/lib/workbench';
import type { WorkspaceSource } from '../../src/renderer/types/workbench';

const SOURCES: WorkspaceSource[] = [
	{ id: 'pr-1', kind: 'pull-request', provider: 'github', title: 'PR one' },
	{ id: 'b-local', kind: 'branch', provider: 'local-git', title: 'main' },
	{ id: 'b-remote', kind: 'branch', provider: 'github', title: 'origin/main' },
	{ id: 'i-linear', kind: 'issue', provider: 'linear', title: 'THE-1' },
];

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
		title: 'THE-1',
	};
	const branchWithWorkspace: WorkspaceSource = {
		hasWorkspace: true,
		id: 'b1',
		kind: 'branch',
		provider: 'local-git',
		title: 'feature',
	};
	const branchWithoutWorkspace: WorkspaceSource = {
		id: 'b2',
		kind: 'branch',
		provider: 'local-git',
		title: 'master',
	};

	expect(getWorkspaceSourceActions(pullRequest).map((a) => a.label)).toEqual([
		'Open',
	]);
	expect(getWorkspaceSourceActions(issue).map((a) => a.label)).toEqual([
		'Create',
	]);
	expect(
		getWorkspaceSourceActions(branchWithWorkspace).map((a) => a.label),
	).toEqual(['Open', 'Duplicate branch']);
	expect(getWorkspaceSourceActions(branchWithWorkspace)[1]?.shortcut).toBe(
		'⌘↵',
	);
	expect(
		getWorkspaceSourceActions(branchWithoutWorkspace).map((a) => a.label),
	).toEqual(['Use branch']);
});

test('labels each provider', () => {
	expect(getWorkspaceSourceProviderLabel('github')).toBe('GitHub');
	expect(getWorkspaceSourceProviderLabel('linear')).toBe('Linear');
	expect(getWorkspaceSourceProviderLabel('local-git')).toBe('Local');
});

test('filters sources by kind and preserves order', () => {
	expect(
		filterWorkspaceSourcesByKind(SOURCES, 'branch').map((source) => source.id),
	).toEqual(['b-local', 'b-remote']);
	expect(filterWorkspaceSourcesByKind(SOURCES, 'pull-request')).toHaveLength(1);
	expect(filterWorkspaceSourcesByKind([], 'issue')).toEqual([]);
});

test('seed fixtures cover every kind plus local/remote branches and both issue providers', () => {
	for (const kind of WORKSPACE_SOURCE_KINDS) {
		expect(
			filterWorkspaceSourcesByKind(defaultWorkspaceSources, kind).length,
		).toBeGreaterThan(0);
	}

	const branches = filterWorkspaceSourcesByKind(
		defaultWorkspaceSources,
		'branch',
	);
	expect(branches.some((source) => source.provider === 'local-git')).toBe(true);
	expect(branches.some((source) => source.provider === 'github')).toBe(true);

	const issues = filterWorkspaceSourcesByKind(defaultWorkspaceSources, 'issue');
	expect(issues.some((source) => source.provider === 'github')).toBe(true);
	expect(issues.some((source) => source.provider === 'linear')).toBe(true);
});
