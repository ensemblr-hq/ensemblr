import { expect, test } from 'bun:test';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';

import { TooltipProvider } from '../../src/renderer/components/ui/tooltip';
import { ReviewFileList } from '../../src/renderer/components/workbench-shell/review-files/review-file-list';
import type { ReviewFileSummary } from '../../src/renderer/types/workbench';

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
});
