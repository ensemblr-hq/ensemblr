import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';

import { LifecycleSummary } from '../../src/renderer/components/workbench-shell/lifecycle-summary';
import {
	getDefaultProject,
	getDefaultWorkspace,
} from '../../src/renderer/fixtures/workbench';
import {
	projectSummaryRows,
	workspaceSummaryRows,
} from '../../src/renderer/lib/workbench/lifecycle-summary-rows';

test('workspaceSummaryRows lists workspace, branch, and path', () => {
	const rows = workspaceSummaryRows({
		...getDefaultWorkspace(),
		branchName: 'psoldunov/fix-archive',
		name: 'ottawa',
		pathLabel: '~/Projects/ensemblr/ottawa',
	});

	expect(rows).toEqual([
		{ label: 'Workspace', value: 'ottawa' },
		{ label: 'Branch', mono: true, value: 'psoldunov/fix-archive' },
		{ label: 'Path', mono: true, value: '~/Projects/ensemblr/ottawa' },
	]);
});

test('workspaceSummaryRows omits the branch row when the workspace has no branch', () => {
	const rows = workspaceSummaryRows({
		...getDefaultWorkspace(),
		branchName: '',
		name: 'detached',
		pathLabel: '/tmp/detached',
	});

	expect(rows.map((row) => row.label)).toEqual(['Workspace', 'Path']);
});

test('projectSummaryRows lists repository and path', () => {
	const rows = projectSummaryRows({
		...getDefaultProject(),
		name: 'ensemblr',
		pathLabel: '~/Projects/ensemblr',
	});

	expect(rows).toEqual([
		{ label: 'Repository', value: 'ensemblr' },
		{ label: 'Path', mono: true, value: '~/Projects/ensemblr' },
	]);
});

test('LifecycleSummary renders each row and marks mono values for wrapping', () => {
	const markup = renderToStaticMarkup(
		<LifecycleSummary
			rows={[
				{ label: 'Workspace', value: 'ottawa' },
				{ label: 'Path', mono: true, value: '/very/long/absolute/path' },
			]}
		/>,
	);

	expect(markup).toContain('Workspace');
	expect(markup).toContain('ottawa');
	expect(markup).toContain('Path');
	expect(markup).toContain('/very/long/absolute/path');
	expect(markup).toContain('font-mono');
	expect(markup).toContain('wrap-anywhere');
});
