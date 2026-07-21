// @vitest-environment happy-dom

import { fireEvent, screen } from '@testing-library/react';
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

describe('AllFilesSearchDialog', () => {
	test('opens the preview for the selected file and closes', () => {
		const openFilePreview = vi.fn();
		const onOpenChange = vi.fn();

		renderWithProviders(
			<ReviewFilePreviewOpenerProvider value={openFilePreview}>
				<AllFilesSearchDialog files={files} onOpenChange={onOpenChange} open />
			</ReviewFilePreviewOpenerProvider>,
		);

		fireEvent.click(
			screen.getByRole('option', { name: 'Open src/main/index.ts preview' }),
		);

		expect(openFilePreview).toHaveBeenCalledWith('src/main/index.ts');
		expect(onOpenChange).toHaveBeenCalledWith(false);
	});

	test('omits directories from the searchable list', () => {
		renderWithProviders(
			<ReviewFilePreviewOpenerProvider value={vi.fn()}>
				<AllFilesSearchDialog files={files} onOpenChange={vi.fn()} open />
			</ReviewFilePreviewOpenerProvider>,
		);

		expect(
			screen.queryByRole('option', { name: /Open src preview/ }),
		).toBeNull();
		expect(
			screen.getByRole('option', { name: 'Open src/main/index.ts preview' }),
		).not.toBeNull();
	});
});
