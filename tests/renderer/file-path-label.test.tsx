// @vitest-environment happy-dom

import { expect, test, vi } from 'vitest';

vi.mock('@iconify/react', () => ({
	addCollection: () => undefined,
	Icon: ({ icon }: { icon: string }) => <span data-icon={icon} />,
}));

import { CodeViewerHeader } from '../../src/renderer/components/code-surface';
import { FilePathLabel } from '../../src/renderer/components/file-path-label';
import { renderWithProviders } from './support/dom';

const PATH = 'src/renderer/lib/workbench/preview-urls.ts';

test('the directory prefix truncates while the file name is held at full width', () => {
	const { container } = renderWithProviders(<FilePathLabel path={PATH} />);
	const [directory, fileName] = Array.from(
		container.querySelectorAll('span > span'),
	);

	expect(directory?.textContent).toBe('src/renderer/lib/workbench/');
	expect(directory?.className).toContain('truncate');
	expect(fileName?.textContent).toBe('preview-urls.ts');
	expect(fileName?.className).toContain('shrink-0');
	expect(fileName?.className).not.toContain('truncate');
});

test('a bare file name renders without an empty directory span', () => {
	const { container } = renderWithProviders(<FilePathLabel path='notes.md' />);

	expect(container.textContent).toBe('notes.md');
	expect(container.querySelectorAll('span > span').length).toBe(1);
});

test('the code viewer header keeps the file name off the truncation path', () => {
	const { container } = renderWithProviders(<CodeViewerHeader title={PATH} />);
	const truncated = container.querySelector('.truncate');

	expect(truncated?.textContent).toBe('src/renderer/lib/workbench/');
	expect(container.textContent).toContain('preview-urls.ts');
});
