// @vitest-environment happy-dom
import { fireEvent, render } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import { describe, expect, test, vi } from 'vitest';

vi.mock('../../src/renderer/components/code-block', () => ({
	CodeBlockContent: () => null,
	highlightCode: () => null,
}));

import { DiffViewer } from '../../src/renderer/components/diff-viewer/diff-viewer';
import { TooltipProvider } from '../../src/renderer/components/ui/tooltip';

const PATCH = `diff --git a/f.ts b/f.ts
index 111..222 100644
--- a/f.ts
+++ b/f.ts
@@ -1,3 +1,4 @@
 export const x = 1;
+export const y = 2;
 const z = x + 1;
 console.log(z);
`;

/**
 * Render the viewer with commenting enabled inside its providers.
 * @param onAddComment - Spy invoked when a comment is submitted
 * @returns The Testing Library render result
 */
/**
 * Fire the hover the gutter/code cells listen for. The row-level `tr` carries no
 * mouse listeners — react-diff-view binds them to the `td` cells — and mouseEnter
 * does not bubble, so each cell must receive the event directly.
 * @param row - The `.diff-line` row whose cells should enter the hover state
 */
function hoverRow(row: Element) {
	for (const cell of row.querySelectorAll('.diff-gutter, .diff-code')) {
		fireEvent.mouseEnter(cell);
	}
}

/**
 * Render the viewer with commenting enabled inside its providers.
 * @param onAddComment - Spy invoked when a comment is submitted
 * @returns The Testing Library render result
 */
function renderViewer(onAddComment: () => void) {
	const store = createStore();
	return render(
		<Provider store={store}>
			<TooltipProvider>
				<DiffViewer filePath='f.ts' onAddComment={onAddComment} patch={PATCH} />
			</TooltipProvider>
		</Provider>,
	);
}

describe('diff gutter add-comment control', () => {
	test('exposes exactly one interactive add-comment button per hovered row', () => {
		const { container } = renderViewer(() => {});
		const row = container.querySelector('.diff-line');
		expect(row).not.toBeNull();

		hoverRow(row as Element);

		const buttons = (row as Element).querySelectorAll('button');
		expect(buttons.length).toBe(1);

		// The gutter cells themselves carry no pointer affordance — only the button.
		for (const gutter of (row as Element).querySelectorAll('.diff-gutter')) {
			expect(getComputedStyle(gutter).cursor).not.toBe('pointer');
		}
	});

	test('clicking the add-comment button opens the composer', () => {
		const { container, queryByPlaceholderText } = renderViewer(() => {});
		const row = container.querySelector('.diff-line') as Element;
		hoverRow(row);
		const button = row.querySelector('button') as HTMLButtonElement;
		fireEvent.click(button);
		expect(
			queryByPlaceholderText(/comment/i) ?? container.querySelector('textarea'),
		).not.toBeNull();
	});
});
