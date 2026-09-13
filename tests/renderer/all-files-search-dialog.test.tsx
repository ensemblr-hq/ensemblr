// @vitest-environment happy-dom

import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';

import { ReviewFilePreviewOpenerProvider } from '../../src/renderer/components/workbench-shell/conversation-panel/file-preview-context';
import { AllFilesSearchDialog } from '../../src/renderer/components/workbench-shell/review-files/all-files-search-dialog';
import type { WorkspaceFileSummary } from '../../src/renderer/types/workbench';
import { renderWithProviders } from './support/dom';

const files: WorkspaceFileSummary[] = [
	{ id: 'src', kind: 'directory', name: 'src', path: 'src' },
	{
		id: 'src/main/index.ts',
		kind: 'file',
		name: 'index.ts',
		path: 'src/main/index.ts',
	},
];

function buildFiles(count: number): WorkspaceFileSummary[] {
	return Array.from({ length: count }, (_unused, index) => ({
		id: `src/file-${index}.ts`,
		kind: 'file' as const,
		name: `file-${index}.ts`,
		path: `src/file-${index}.ts`,
	}));
}

function renderDialog(
	props: Partial<Parameters<typeof AllFilesSearchDialog>[0]> = {},
	openFilePreview = vi.fn(),
) {
	const result = renderWithProviders(
		<ReviewFilePreviewOpenerProvider value={openFilePreview}>
			<AllFilesSearchDialog
				files={files}
				onOpenChange={vi.fn()}
				open
				{...props}
			/>
		</ReviewFilePreviewOpenerProvider>,
	);
	return { ...result, openFilePreview };
}

function typeQuery(value: string): void {
	fireEvent.change(screen.getByPlaceholderText('Search files'), {
		target: { value },
	});
}

describe('AllFilesSearchDialog', () => {
	test('opens the preview for the selected file and closes', () => {
		const openFilePreview = vi.fn();
		const onOpenChange = vi.fn();

		renderDialog({ onOpenChange }, openFilePreview);

		fireEvent.click(
			screen.getByRole('option', { name: 'Open src/main/index.ts preview' }),
		);

		expect(openFilePreview).toHaveBeenCalledWith('src/main/index.ts');
		expect(onOpenChange).toHaveBeenCalledWith(false);
	});

	test('omits directories from the searchable list', () => {
		renderDialog();

		expect(
			screen.queryByRole('option', { name: /Open src preview/ }),
		).toBeNull();
		expect(
			screen.getByRole('option', { name: 'Open src/main/index.ts preview' }),
		).not.toBeNull();
	});

	test('caps the rows it renders for a large workspace', () => {
		renderDialog({ files: buildFiles(200) });

		expect(screen.getAllByRole('option')).toHaveLength(50);
	});

	test('drops rows the settled query does not match', async () => {
		renderDialog({
			files: [
				...files,
				{
					id: 'docs/readme.md',
					kind: 'file',
					name: 'readme.md',
					path: 'docs/readme.md',
				},
			],
		});

		typeQuery('index');

		await waitFor(() => {
			expect(screen.getAllByRole('option')).toHaveLength(1);
		});
		expect(
			screen.getByRole('option', { name: 'Open src/main/index.ts preview' }),
		).not.toBeNull();
	});

	test('ranks a name match above a path-only match', async () => {
		renderDialog({
			files: [
				{
					id: 'main/deep/nested/other.ts',
					kind: 'file',
					name: 'other.ts',
					path: 'main/deep/nested/other.ts',
				},
				{
					id: 'src/main.ts',
					kind: 'file',
					name: 'main.ts',
					path: 'src/main.ts',
				},
			],
		});

		typeQuery('main');

		await waitFor(() => {
			expect(screen.getAllByRole('option')[0]).toHaveAttribute(
				'aria-label',
				'Open src/main.ts preview',
			);
		});
	});

	test('keeps the top match selected so Enter opens it', async () => {
		const openFilePreview = vi.fn();
		renderDialog({ files: buildFiles(200) }, openFilePreview);

		typeQuery('file-7.ts');

		await waitFor(() => {
			expect(screen.getAllByRole('option')[0]).toHaveAttribute(
				'aria-label',
				'Open src/file-7.ts preview',
			);
		});
		expect(screen.getAllByRole('option')[0]).toHaveAttribute(
			'aria-selected',
			'true',
		);

		fireEvent.keyDown(screen.getByPlaceholderText('Search files'), {
			key: 'Enter',
		});

		expect(openFilePreview).toHaveBeenCalledWith('src/file-7.ts');
	});

	test('keeps an arrow-key selection when the listing refreshes', async () => {
		const openFilePreview = vi.fn();
		const { rerender } = renderDialog(
			{ files: buildFiles(200) },
			openFilePreview,
		);

		typeQuery('file-1.ts');
		await waitFor(() => {
			expect(screen.getAllByRole('option')[0]).toHaveAttribute(
				'aria-label',
				'Open src/file-1.ts preview',
			);
		});

		const input = screen.getByPlaceholderText('Search files');
		fireEvent.keyDown(input, { key: 'ArrowDown' });
		const selectedLabel = screen
			.getAllByRole('option')[1]
			?.getAttribute('aria-label');
		expect(screen.getAllByRole('option')[1]).toHaveAttribute(
			'aria-selected',
			'true',
		);

		rerender(
			<ReviewFilePreviewOpenerProvider value={openFilePreview}>
				<AllFilesSearchDialog
					files={buildFiles(200)}
					onOpenChange={vi.fn()}
					open
				/>
			</ReviewFilePreviewOpenerProvider>,
		);

		expect(screen.getByRole('option', { selected: true })).toHaveAttribute(
			'aria-label',
			selectedLabel,
		);
	});

	test('rewinds the list when a new query settles', async () => {
		renderDialog({ files: buildFiles(200) });
		const list = document.querySelector('[data-slot="command-list"]');
		if (!(list instanceof HTMLElement)) {
			throw new Error('command list did not render');
		}
		list.scrollTop = 400;
		expect(list.scrollTop).toBe(400);

		typeQuery('file-9');

		await waitFor(() => {
			expect(list.scrollTop).toBe(0);
		});
	});

	test('reports an empty state when nothing matches', async () => {
		renderDialog();

		typeQuery('zzzznotafile');

		await waitFor(() => {
			expect(screen.getByText('No files match your search.')).not.toBeNull();
		});
		expect(screen.queryAllByRole('option')).toHaveLength(0);
		expect(screen.queryByText('Files')).toBeNull();
	});

	test('clears the query when the dialog closes', async () => {
		const { rerender } = renderDialog();

		typeQuery('index');
		await waitFor(() => {
			expect(screen.getAllByRole('option')).toHaveLength(1);
		});

		rerender(
			<ReviewFilePreviewOpenerProvider value={vi.fn()}>
				<AllFilesSearchDialog
					files={files}
					onOpenChange={vi.fn()}
					open={false}
				/>
			</ReviewFilePreviewOpenerProvider>,
		);
		rerender(
			<ReviewFilePreviewOpenerProvider value={vi.fn()}>
				<AllFilesSearchDialog files={files} onOpenChange={vi.fn()} open />
			</ReviewFilePreviewOpenerProvider>,
		);

		expect(screen.getByPlaceholderText('Search files')).toHaveValue('');
	});
});
