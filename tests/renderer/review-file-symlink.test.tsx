// @vitest-environment happy-dom

import { Icon } from '@iconify/react';
import { fireEvent, screen } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, expect, test, vi } from 'vitest';

import { TooltipProvider } from '../../src/renderer/components/ui/tooltip';
import {
	ReviewFilePreviewOpenerProvider,
	WorkspaceFileDiffOpenerProvider,
} from '../../src/renderer/components/workbench-shell/conversation-panel/file-preview-context';
import { ReviewFileActionsProvider } from '../../src/renderer/components/workbench-shell/review-files/review-file-actions-context';
import { ReviewFileList } from '../../src/renderer/components/workbench-shell/review-files/review-file-list';
import { ReviewFileRow } from '../../src/renderer/components/workbench-shell/review-files/review-file-row';
import { registerIconCollections } from '../../src/renderer/lib/workbench/icon-collections';
import type {
	ReviewFileActions,
	ReviewFileSummary,
} from '../../src/renderer/types/workbench';
import { installLocalStorage, renderWithProviders } from './support/dom';

const actions: ReviewFileActions = {
	attachDiff: () => {},
	copyTarget: undefined,
	invokeTarget: async () => {},
	isDiscardable: () => false,
	isDiscarding: () => false,
	isViewed: () => false,
	onDiscardFile: () => {},
	openFile: () => {},
	openInTargets: [],
};

/** A changed-file row, optionally carrying the link target git resolved. */
function changedFile(
	overrides: Partial<ReviewFileSummary> & { path: string },
): ReviewFileSummary {
	return {
		additions: 1,
		contentId: null,
		deletions: 0,
		id: overrides.path,
		status: 'modified',
		...overrides,
	};
}

/** Renders one changed-file row to markup so its icon can be compared. */
function renderRow(file: ReviewFileSummary): string {
	return renderToStaticMarkup(
		<TooltipProvider>
			<ReviewFileActionsProvider value={actions}>
				<ReviewFileRow file={file} showPath={false} />
			</ReviewFileActionsProvider>
		</TooltipProvider>,
	);
}

/** The bundled glyph for an icon name, as the row would draw it. */
function glyphBody(iconName: string): string {
	const markup = renderToStaticMarkup(<Icon icon={iconName} />);
	const body = markup.match(/<svg[^>]*>([\s\S]*)<\/svg>/);
	if (!body?.[1]) {
		throw new Error(`No bundled glyph for ${iconName}`);
	}
	return body[1];
}

beforeEach(() => {
	registerIconCollections();
	installLocalStorage();
});

test('a changed symlink to a directory draws the folder shortcut glyph', () => {
	const markup = renderRow(
		changedFile({ path: 'vendor/shared', symlinkTargetKind: 'directory' }),
	);

	expect(markup).toContain(glyphBody('ensemblr:folder-symlink'));
	expect(markup).not.toContain(glyphBody('ensemblr:file-symlink'));
});

test('a changed symlink to a file draws the file shortcut glyph', () => {
	const markup = renderRow(
		changedFile({ path: 'linked.ts', symlinkTargetKind: 'file' }),
	);

	expect(markup).toContain(glyphBody('ensemblr:file-symlink'));
});

test('an ordinary changed file keeps its file-type icon', () => {
	const markup = renderRow(changedFile({ path: 'src/app.ts' }));

	expect(markup).not.toContain(glyphBody('ensemblr:file-symlink'));
	expect(markup).not.toContain(glyphBody('ensemblr:folder-symlink'));
});

/** Renders the changes list with spy openers for the given rows. */
function renderChanges(files: ReviewFileSummary[]) {
	const openDiff = vi.fn();
	const openPreview = vi.fn();

	renderWithProviders(
		<WorkspaceFileDiffOpenerProvider value={openDiff}>
			<ReviewFilePreviewOpenerProvider value={openPreview}>
				<ReviewFileList
					files={files}
					onDiscardFile={() => {}}
					viewMode='list'
					workspaceCwd='/tmp/ws'
					workspaceId='w1'
				/>
			</ReviewFilePreviewOpenerProvider>
		</WorkspaceFileDiffOpenerProvider>,
	);

	return { openDiff, openPreview };
}

/** Right-clicks a changed-file row to open the shared menu. */
function openRowMenu(path: string) {
	const row = document.querySelector<HTMLElement>(`[data-row-path="${path}"]`);
	if (!row) {
		throw new Error(`No changed-file row for ${path}`);
	}
	fireEvent.contextMenu(row);
}

test('a changed symlink to a directory opens neither the diff nor the preview', () => {
	const file = changedFile({
		path: 'tests2',
		symlinkTargetKind: 'directory',
	});
	const { openDiff, openPreview } = renderChanges([file]);
	const row = screen.getByRole('button', {
		name: 'tests2 links to a directory and cannot be opened',
	});

	fireEvent.click(row);
	fireEvent.doubleClick(row);

	expect(openDiff).not.toHaveBeenCalled();
	expect(openPreview).not.toHaveBeenCalled();
	expect(row).toHaveAttribute('aria-disabled', 'true');
});

test('a directory link named like an image opens nothing either', () => {
	const file = changedFile({
		path: 'assets/logo.png',
		symlinkTargetKind: 'directory',
	});
	const { openDiff, openPreview } = renderChanges([file]);

	fireEvent.click(
		screen.getByRole('button', {
			name: 'assets/logo.png links to a directory and cannot be opened',
		}),
	);

	expect(openDiff).not.toHaveBeenCalled();
	expect(openPreview).not.toHaveBeenCalled();
});

test('a changed symlink to a file still opens its diff', () => {
	const file = changedFile({ path: 'linked.ts', symlinkTargetKind: 'file' });
	const { openDiff } = renderChanges([file]);

	fireEvent.click(screen.getByRole('button', { name: 'Open linked.ts' }));

	expect(openDiff).toHaveBeenCalledWith('linked.ts', undefined, undefined);
});

test('the right-click menu drops View and Keep open for a directory link', async () => {
	renderChanges([
		changedFile({ path: 'tests2', symlinkTargetKind: 'directory' }),
	]);

	openRowMenu('tests2');

	expect(
		await screen.findByRole('menuitem', { name: 'Attach diff to chat' }),
	).toBeInTheDocument();
	expect(screen.queryByRole('menuitem', { name: 'View' })).toBeNull();
	expect(screen.queryByRole('menuitem', { name: 'Keep open' })).toBeNull();
});
