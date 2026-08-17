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
		contentId: null,
		deletions: 3,
		id: 'a',
		path: 'src/main/ipc/handlers/workspace-files.ts',
		status: 'modified',
	},
	{
		additions: 5,
		contentId: null,
		deletions: 1,
		id: 'b',
		path: 'src/main/repository/create-workspace.ts',
		status: 'modified',
	},
];

function renderList(
	viewMode: 'folders' | 'list',
	conflictPaths?: ReadonlySet<string>,
) {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	return renderToStaticMarkup(
		<QueryClientProvider client={queryClient}>
			<TooltipProvider>
				<ReviewFileList
					conflictPaths={conflictPaths}
					files={files}
					onDiscardFile={() => {}}
					viewMode={viewMode}
					workspaceCwd='/tmp/ws'
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
					workspaceCwd='/tmp/ws'
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

test('conflicting paths split the flat list into Conflicts then Clean', () => {
	const markup = renderList(
		'list',
		new Set(['src/main/repository/create-workspace.ts']),
	);

	expect(markup).toContain('Conflicts');
	expect(markup).toContain('Clean');
	// The conflicting file leads, ahead of the clean one it followed before.
	expect(markup.indexOf('create-workspace.ts')).toBeLessThan(
		markup.indexOf('workspace-files.ts'),
	);
});

test('an empty conflict set leaves the flat list exactly as it was', () => {
	expect(renderList('list', new Set())).toEqual(renderList('list'));
});

test('a conflict set matching no changed file leaves the list ungrouped', () => {
	const markup = renderList('list', new Set(['some/other/file.ts']));

	expect(markup).not.toContain('Conflicts');
	expect(markup).toEqual(renderList('list'));
});

test('folders mode marks conflicting files even though it never groups them', () => {
	const markup = renderList(
		'folders',
		new Set(['src/main/repository/create-workspace.ts']),
	);

	// The tree keeps its structure — no Conflicts/Clean bands — but the row that
	// will not merge still reads as conflicted.
	expect(markup).not.toContain('Conflicts');
	expect(markup).toContain('aria-label="Conflicted"');
	expect(markup).toContain('>U<');
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
					workspaceCwd='/tmp/ws'
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
		output: 'fatal: bad revision HEAD',
	});

	expect(markup).toContain('Could not read changes');
	expect(markup).toContain('text-status-danger');
	expect(markup).toContain('font-mono');
	expect(markup).toContain('fatal: bad revision HEAD');
});

// git wrote nothing, so `message` is our own English fallback. Demoting it would
// put an untranslated sentence in a Russian panel dressed as git's words.
test('a read failure with no git output shows the explanation alone', () => {
	const markup = renderError({
		code: 'command-failed',
		message: 'git status failed in workspace.',
	});

	expect(markup).toContain('Could not read changes');
	expect(markup).not.toContain('git status failed in workspace.');
});

test('a missing git repository is named instead of shown as a raw git error', () => {
	const markup = renderError({
		code: 'not-a-git-repo',
		message:
			'fatal: not a git repository (or any of the parent directories): .git',
		output:
			'fatal: not a git repository (or any of the parent directories): .git',
	});

	expect(markup).toContain('Not a git repository');
	expect(markup).toContain('not tracked by git');
	expect(markup).toContain('Initialize a repository here');
});
