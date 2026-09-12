// @vitest-environment happy-dom

/**
 * `react-diff-view` lays out one table row per change line and one `<span>` per
 * syntax token inside it, with no windowing and no size guard anywhere — so a
 * 5,000-line diff is on the order of 50,000 DOM nodes for one file, committed at
 * once, after the tokenizer has already run to completion.
 *
 * The viewer therefore lays out whole hunks up to a row budget and offers the
 * rest behind a control. This counts the rows that actually reach the DOM.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createStore, Provider } from 'jotai';
import { describe, expect, test } from 'vitest';

import { DiffViewer } from '@/renderer/components/diff-viewer/diff-viewer';
import { MAX_RENDERED_DIFF_ROWS } from '@/renderer/components/diff-viewer/hunk-budget';
import { TooltipProvider } from '@/renderer/components/ui/tooltip';

import { installLocalStorage } from '../support/dom';

/** Lines per hunk in the fixture below; small enough to land the trim exactly. */
const HUNK_LINES = 100;

/**
 * Builds a patch of `count` hunks, each adding `HUNK_LINES` lines at a distinct
 * offset so the hunks never abut.
 * @param count - How many hunks the file carries
 * @returns A unified patch
 */
function patchOf(count: number): string {
	const hunks = Array.from({ length: count }, (_, index) => {
		const start = index * (HUNK_LINES + 20) + 1;
		const body = Array.from(
			{ length: HUNK_LINES },
			(_, line) => `+line ${index}-${line}`,
		).join('\n');
		return `@@ -${start},0 +${start},${HUNK_LINES} @@\n${body}`;
	}).join('\n');
	return `diff --git a/big.ts b/big.ts\nindex 111..222 100644\n--- a/big.ts\n+++ b/big.ts\n${hunks}\n`;
}

/** Renders the viewer inside the providers its toolbar and tooltips need. */
function renderViewer(patch: string) {
	installLocalStorage();
	return render(
		<Provider store={createStore()}>
			<TooltipProvider>
				<DiffViewer fillHeight={false} filePath='big.ts' patch={patch} />
			</TooltipProvider>
		</Provider>,
	);
}

/** How many change rows the viewer actually laid out. */
function laidOutRows(container: HTMLElement): number {
	return container.querySelectorAll('tbody tr.diff-line').length;
}

describe('the diff row budget', () => {
	test('lays out a small diff whole, with no control below it', () => {
		const { container } = renderViewer(patchOf(2));

		expect(laidOutRows(container)).toBe(2 * HUNK_LINES);
		expect(screen.queryByRole('button', { name: /remaining/ })).toBeNull();
	});

	test('stops at the row budget on a diff that exceeds it', () => {
		const hunks = Math.ceil(MAX_RENDERED_DIFF_ROWS / HUNK_LINES) + 6;
		const { container } = renderViewer(patchOf(hunks));

		expect(laidOutRows(container)).toBeLessThanOrEqual(MAX_RENDERED_DIFF_ROWS);
		expect(laidOutRows(container)).toBeLessThan(hunks * HUNK_LINES);
	});

	test('lays out the rest on request', async () => {
		const hunks = Math.ceil(MAX_RENDERED_DIFF_ROWS / HUNK_LINES) + 6;
		const { container } = renderViewer(patchOf(hunks));

		await userEvent.click(
			screen.getByRole('button', { name: /Show the remaining/ }),
		);

		expect(laidOutRows(container)).toBe(hunks * HUNK_LINES);
		expect(screen.queryByRole('button', { name: /remaining/ })).toBeNull();
	});
});
