import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';

import { TooltipProvider } from '../../src/renderer/components/ui/tooltip';
import { ReviewFileList } from '../../src/renderer/components/workbench-shell/review-files/review-file-list';
import type { ReviewFileSummary } from '../../src/renderer/types/workbench';
import type { WorkspaceGitFailure } from '../../src/shared/ipc/contracts/workspace-git';

const files: ReviewFileSummary[] = [
	{
		additions: 10,
		deletions: 3,
		id: 'a',
		path: 'src/main/ipc/handlers/workspace-files.ts',
		status: 'modified',
	},
	{
		additions: 5,
		deletions: 1,
		id: 'b',
		path: 'src/main/repository/create-workspace.ts',
		status: 'modified',
	},
];

function renderList(viewMode: 'folders' | 'list') {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	return renderToStaticMarkup(
		<QueryClientProvider client={queryClient}>
			<TooltipProvider>
				<ReviewFileList
					files={files}
					onDiscardFile={() => {}}
					viewMode={viewMode}
					workspaceId='w1'
				/>
			</TooltipProvider>
		</QueryClientProvider>,
	);
}

function renderError(error: WorkspaceGitFailure) {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	return renderToStaticMarkup(
		<QueryClientProvider client={queryClient}>
			<TooltipProvider>
				<ReviewFileList
					error={error}
					files={[]}
					onDiscardFile={() => {}}
					viewMode='list'
					workspaceId='w1'
				/>
			</TooltipProvider>
		</QueryClientProvider>,
	);
}

test('list mode renders a flat list with dimmed directory prefixes', () => {
	const markup = renderList('list');

	expect(markup).not.toContain('role="tree"');
	expect(markup).toContain('>src/main/ipc/handlers/</span>');
});

test('folders mode renders a collapsible tree, not a flat list', () => {
	const markup = renderList('folders');

	expect(markup).toContain('role="tree"');
	// Directory chain is shown by folder rows, so no inline dimmed prefix.
	expect(markup).not.toContain('>src/main/ipc/handlers/</span>');
});

test('the view switcher actually changes the rendered output', () => {
	expect(renderList('list')).not.toBe(renderList('folders'));
});

test('empty change set shows the empty state in either mode', () => {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	const markup = renderToStaticMarkup(
		<QueryClientProvider client={queryClient}>
			<TooltipProvider>
				<ReviewFileList
					files={[]}
					onDiscardFile={() => {}}
					viewMode='list'
					workspaceId='w1'
				/>
			</TooltipProvider>
		</QueryClientProvider>,
	);

	expect(markup).toContain('No file changes yet');
	expect(markup).toContain('Changes appear here.');
	expect(markup).toContain('<svg');
});

test('a generic read failure leads with plain copy and demotes the raw error', () => {
	const markup = renderError({
		code: 'command-failed',
		message: 'fatal: bad revision HEAD',
	});

	expect(markup).toContain('Could not read changes');
	expect(markup).toContain('text-status-danger');
	expect(markup).toContain('font-mono');
	expect(markup).toContain('fatal: bad revision HEAD');
});

test('a missing git repository is named instead of shown as a raw git error', () => {
	const markup = renderError({
		code: 'not-a-git-repo',
		message:
			'fatal: not a git repository (or any of the parent directories): .git',
	});

	expect(markup).toContain('Not a git repository');
	expect(markup).toContain('not tracked by git');
	expect(markup).toContain('Initialize a repository here');
});
