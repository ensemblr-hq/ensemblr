// @vitest-environment happy-dom

import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { AnswerTable } from '../../src/renderer/components/answer-table';
import { CodeSurface } from '../../src/renderer/components/code-surface';
import { renderWithProviders } from './support/dom';

const TABLE_ROWS = (
	<>
		<thead>
			<tr>
				<th>Step</th>
				<th>Command</th>
			</tr>
		</thead>
		<tbody>
			<tr>
				<td>Types</td>
				<td>npm run typecheck</td>
			</tr>
		</tbody>
	</>
);

/**
 * Replaces the clipboard with a recorder that accepts both the plain and the
 * rich write paths, so a test can assert what a copy control actually offered.
 */
function stubClipboard() {
	const written: { html?: string; text: string }[] = [];
	class TestClipboardItem {
		constructor(readonly items: Record<string, Blob>) {}
	}
	Object.defineProperty(globalThis, 'ClipboardItem', {
		configurable: true,
		value: TestClipboardItem,
		writable: true,
	});
	Object.defineProperty(navigator, 'clipboard', {
		configurable: true,
		value: {
			write: async (entries: TestClipboardItem[]) => {
				for (const entry of entries) {
					written.push({
						html: await entry.items['text/html']?.text(),
						text: (await entry.items['text/plain']?.text()) ?? '',
					});
				}
			},
			writeText: async (text: string) => {
				written.push({ text });
			},
		},
		writable: true,
	});
	return written;
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe('answer table controls', () => {
	test('offers copy and expand, each labelled for its tooltip', () => {
		renderWithProviders(<AnswerTable>{TABLE_ROWS}</AnswerTable>);

		expect(screen.getByLabelText('Copy table')).toBeTruthy();
		expect(screen.getByLabelText('Expand table')).toBeTruthy();
	});

	test('copies the table as Markdown alongside its HTML', async () => {
		const written = stubClipboard();
		renderWithProviders(<AnswerTable>{TABLE_ROWS}</AnswerTable>);

		fireEvent.click(screen.getByLabelText('Copy table'));

		await waitFor(() => expect(written).toHaveLength(1));
		expect(written[0].text).toBe(
			[
				'| Step | Command |',
				'| --- | --- |',
				'| Types | npm run typecheck |',
			].join('\n'),
		);
		expect(written[0].html).toContain('<table');
	});

	test('confirms a copy the way the code panel does', async () => {
		stubClipboard();
		renderWithProviders(<AnswerTable>{TABLE_ROWS}</AnswerTable>);

		fireEvent.click(screen.getByLabelText('Copy table'));

		await waitFor(() =>
			expect(
				screen
					.getByLabelText('Copy table')
					.className.includes('text-status-ok'),
			).toBe(true),
		);
	});

	test('expands into a dialog that keeps the same controls', async () => {
		renderWithProviders(<AnswerTable>{TABLE_ROWS}</AnswerTable>);

		fireEvent.click(screen.getByLabelText('Expand table'));

		await waitFor(() =>
			expect(screen.getByLabelText('Collapse table')).toBeTruthy(),
		);
		expect(screen.getAllByLabelText('Copy table')).toHaveLength(2);
	});
});

describe('floating control parity', () => {
	test('code surfaces and answer tables float the same control chrome', () => {
		const table = renderWithProviders(
			<AnswerTable>{TABLE_ROWS}</AnswerTable>,
		).container;
		const code = renderWithProviders(
			<CodeSurface copyText='npm run check'>body</CodeSurface>,
		).container;

		const tableCopy = table.querySelector('[aria-label="Copy table"]');
		const codeCopy = code.querySelector('[aria-label="Copy code"]');

		expect(tableCopy?.className).toBe(codeCopy?.className);
		expect(tableCopy?.parentElement?.className).toBe(
			codeCopy?.parentElement?.className,
		);
		expect(table.querySelector('.group\\/block')).toBeTruthy();
		expect(code.querySelector('.group\\/block')).toBeTruthy();
	});
});
