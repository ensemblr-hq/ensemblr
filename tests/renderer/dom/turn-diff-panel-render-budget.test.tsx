// @vitest-environment happy-dom

/**
 * The whole-turn diff tab mounted one `DiffViewer` per changed file, and each
 * viewer laid out its own file with no regard for the others — so a turn that
 * touched a few hundred files, or added one generated file, committed tens of
 * thousands of table rows in a single render. The surface now spends one row
 * budget across the whole turn and offers the files it withheld behind a
 * control. This counts the rows that actually reach the DOM.
 */

import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('@iconify/react', () => ({
	addCollection: () => undefined,
	Icon: ({ icon }: { icon: string }) => <span data-icon={icon} />,
}));

import { ensemblrQueryKeys } from '@/renderer/api/ensemblr-queries';
import {
	MAX_RENDERED_DIFF_ROWS,
	MAX_RENDERED_TURN_DIFF_ROWS,
} from '@/renderer/components/diff-viewer/hunk-budget';
import { TurnDiffPanel } from '@/renderer/components/workbench-shell/conversation-panel/turn-diff-panel';
import type { ComputeTurnDiffResult } from '@/shared/ipc/contracts/checkpoint';

import {
	createTestQueryClient,
	installLocalStorage,
	renderWithProviders,
} from '../support/dom';

const turnId = 'turn-budget';

/** Lines each ordinary generated file adds. */
const LINES_PER_FILE = 500;

/** Files a turn needs before its rows exceed the turn budget, plus a margin. */
const OVER_BUDGET_FILES =
	Math.ceil(MAX_RENDERED_TURN_DIFF_ROWS / LINES_PER_FILE) + 8;

/**
 * Builds the patch for one newly added file of `lines` lines.
 * @param path - Repository-relative path of the file
 * @param lines - How many lines the file adds
 * @returns A single-file unified patch
 */
function addedFilePatch(path: string, lines: number): string {
	const body = Array.from(
		{ length: lines },
		(_, line) => `+const value${line} = ${line};`,
	).join('\n');
	return `diff --git a/${path} b/${path}\nnew file mode 100644\nindex 0000000..1111111\n--- /dev/null\n+++ b/${path}\n@@ -0,0 +1,${lines} @@\n${body}\n`;
}

/**
 * Seeds a turn diff with one added file per entry of `lineCounts` and renders
 * the panel over it.
 * @param lineCounts - How many lines each changed file adds, in order
 * @returns The render result
 */
function renderTurn(lineCounts: readonly number[]) {
	const paths = lineCounts.map((_, index) => `src/gen/file-${index}.ts`);
	const result: ComputeTurnDiffResult = {
		checkpoint: {
			agentSessionId: 'session-1',
			createdAt: '2026-09-30T12:00:00.000Z',
			gitHash: 'abc123',
			gitRef: 'refs/ensemblr/checkpoints/turn-budget',
			id: 'checkpoint-budget',
			label: 'generate files',
			turnId,
			workspaceId: 'workspace-1',
		},
		files: paths.map((path, index) => ({
			additions: lineCounts[index],
			deletions: 0,
			path,
			status: 'added' as const,
		})),
		ok: true,
		patch: paths
			.map((path, index) => addedFilePatch(path, lineCounts[index]))
			.join(''),
	};
	const client = createTestQueryClient();
	client.setQueryData(ensemblrQueryKeys.turnDiff(turnId), result);
	return renderWithProviders(<TurnDiffPanel turnId={turnId} />, { client });
}

/**
 * A turn of `count` files that each add {@link LINES_PER_FILE} lines.
 * @param count - How many files the turn changed
 * @returns The per-file line counts
 */
function evenTurn(count: number): number[] {
	return Array.from({ length: count }, () => LINES_PER_FILE);
}

/** How many change rows the surface actually laid out. */
function laidOutRows(container: HTMLElement): number {
	return container.querySelectorAll('tbody tr.diff-line').length;
}

/** How many per-file diff viewers reached the DOM. */
function mountedFiles(container: HTMLElement): number {
	return container.querySelectorAll('.ensemblr-diff-pane').length;
}

/** The control that lays out the files the budget withheld. */
function moreFilesButton(): HTMLElement | null {
	return screen.queryByRole('button', { name: /^Show \d+ more files?$/ });
}

beforeEach(() => {
	installLocalStorage();
});

describe('the whole-turn diff row budget', () => {
	test('lays out an ordinary turn whole, with no control below it', () => {
		const { container } = renderTurn(evenTurn(3));

		expect(mountedFiles(container)).toBe(3);
		expect(laidOutRows(container)).toBe(3 * LINES_PER_FILE);
		expect(moreFilesButton()).toBeNull();
	});

	test('cuts one huge added file to the per-file row budget', () => {
		const { container } = renderTurn([MAX_RENDERED_DIFF_ROWS + 900]);

		expect(laidOutRows(container)).toBeLessThanOrEqual(MAX_RENDERED_DIFF_ROWS);
		expect(
			screen.getByRole('button', { name: /Show the remaining 900 lines/ }),
		).toBeInTheDocument();
	});

	test('does not let one huge file push the rest of the turn behind the control', () => {
		const { container } = renderTurn([MAX_RENDERED_DIFF_ROWS + 3_000, 40, 40]);

		expect(mountedFiles(container)).toBe(3);
		expect(laidOutRows(container)).toBeLessThanOrEqual(
			MAX_RENDERED_DIFF_ROWS + 80,
		);
		expect(moreFilesButton()).toBeNull();
	});

	test('stops mounting files once the turn budget is spent', () => {
		const { container } = renderTurn(evenTurn(OVER_BUDGET_FILES));

		expect(laidOutRows(container)).toBeLessThanOrEqual(
			MAX_RENDERED_TURN_DIFF_ROWS,
		);
		expect(mountedFiles(container)).toBeLessThan(OVER_BUDGET_FILES);
		expect(moreFilesButton()).toBeInTheDocument();
	});

	test('still lists every changed file in the summary', () => {
		renderTurn(evenTurn(OVER_BUDGET_FILES));

		expect(screen.getByText(`${OVER_BUDGET_FILES} files`)).toBeInTheDocument();
		for (let index = 0; index < OVER_BUDGET_FILES; index += 1) {
			expect(screen.getByText(`src/gen/file-${index}.ts`)).toBeInTheDocument();
		}
	});

	test('names how many files the control lays out next', () => {
		const { container } = renderTurn(evenTurn(OVER_BUDGET_FILES));
		const withheld = OVER_BUDGET_FILES - mountedFiles(container);

		expect(
			screen.getByRole('button', { name: `Show ${withheld} more files` }),
		).toBeInTheDocument();
	});

	test('lays out the next window on request and stays bounded', async () => {
		const twoWindows =
			2 * Math.ceil(MAX_RENDERED_TURN_DIFF_ROWS / LINES_PER_FILE);
		const { container } = renderTurn(evenTurn(twoWindows + 6));
		const before = mountedFiles(container);

		await userEvent.click(moreFilesButton() as HTMLElement);

		expect(mountedFiles(container)).toBeGreaterThan(before);
		expect(laidOutRows(container)).toBeLessThanOrEqual(
			2 * MAX_RENDERED_TURN_DIFF_ROWS,
		);
		expect(moreFilesButton()).toBeInTheDocument();
	});

	test('lays out every file once the last window is requested', async () => {
		const { container } = renderTurn(evenTurn(OVER_BUDGET_FILES));

		await userEvent.click(moreFilesButton() as HTMLElement);

		expect(mountedFiles(container)).toBe(OVER_BUDGET_FILES);
		expect(laidOutRows(container)).toBe(OVER_BUDGET_FILES * LINES_PER_FILE);
		expect(moreFilesButton()).toBeNull();
	});
});
