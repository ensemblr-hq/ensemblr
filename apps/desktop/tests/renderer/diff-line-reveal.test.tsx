// @vitest-environment happy-dom
import { render } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import { act } from 'react';
import { afterEach, describe, expect, test, vi } from 'vitest';

vi.mock('../../src/renderer/components/code-block', () => ({
	CodeBlockContent: () => null,
}));
vi.mock('../../src/renderer/lib/code/highlighter', () => ({
	highlightCode: () => null,
}));

import { DiffViewer } from '../../src/renderer/components/diff-viewer/diff-viewer';
import { TooltipProvider } from '../../src/renderer/components/ui/tooltip';
import type { DiffLineReveal } from '../../src/renderer/types/diff';

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

/** The whole file, of which the patch above touches only the opening lines. */
const FULL_FILE = [
	'export const x = 1;',
	'export const y = 2;',
	'const z = x + 1;',
	'console.log(z);',
	'const far = 1;',
	'const further = 2;',
	'export const tail = far + further;',
].join('\n');

const scrollCalls: Element[] = [];

const scrollSpy = vi
	.spyOn(Element.prototype, 'scrollIntoView')
	.mockImplementation(function scrollIntoView(this: Element) {
		scrollCalls.push(this);
	});

afterEach(() => {
	scrollCalls.length = 0;
	scrollSpy.mockClear();
});

/**
 * Render the viewer with a reveal request inside its providers.
 * @param reveal - The pending reveal, or null
 * @param fullFileContent - Full file source, enabling the full-file escalation
 * @param onRevealSettled - Reports a request as served or ruled out
 * @returns The render result, plus rerenders that swap the reveal or the source
 */
function renderViewer(
	reveal: DiffLineReveal | null,
	fullFileContent?: string | null,
	onRevealSettled?: (requestId: number) => void,
) {
	const store = createStore();
	const ui = (next: DiffLineReveal | null, source?: string | null) => (
		<Provider store={store}>
			<TooltipProvider>
				<DiffViewer
					filePath='f.ts'
					fullFileContent={source}
					onRevealSettled={onRevealSettled}
					patch={PATCH}
					reveal={next}
				/>
			</TooltipProvider>
		</Provider>
	);
	const result = render(ui(reveal, fullFileContent));
	return {
		...result,
		setReveal: (next: DiffLineReveal | null) =>
			result.rerender(ui(next, fullFileContent)),
	};
}

/**
 * Render the viewer the way the panel does when the full-file source is still in
 * flight: the diff query has resolved, `readWorkspaceFile` has not.
 * @param reveal - The pending reveal
 * @returns A rerender that lands the source, as the second query resolving does
 */
function renderViewerAwaitingSource(reveal: DiffLineReveal) {
	const store = createStore();
	const ui = (source: string | null, pending: boolean) => (
		<Provider store={store}>
			<TooltipProvider>
				<DiffViewer
					filePath='f.ts'
					fullFileContent={source}
					fullFileContentPending={pending}
					patch={PATCH}
					reveal={reveal}
				/>
			</TooltipProvider>
		</Provider>
	);
	const result = render(ui(null, true));
	return {
		...result,
		landSource: () => result.rerender(ui(FULL_FILE, false)),
	};
}

describe('revealing a diff line', () => {
	test('scrolls the row that carries the requested line', () => {
		const { container } = renderViewer({ line: 2, requestId: 1, side: 'new' });

		const target = container.querySelector('[data-change-key="I2"]');
		expect(target).not.toBeNull();
		expect(scrollCalls).toHaveLength(1);
		// Assert the row, not merely that something scrolled: addressing the row by
		// its change key is the whole mechanism.
		expect(scrollCalls[0]).toBe(target?.closest('tr'));
	});

	test('flashes the row it landed on', () => {
		const { container } = renderViewer({ line: 2, requestId: 1, side: 'new' });

		expect(
			container.querySelector('.diff-code-selected, .diff-gutter-selected'),
		).not.toBeNull();
	});

	test('scrolls again for the same line under a new request id', () => {
		const { setReveal } = renderViewer({ line: 2, requestId: 1, side: 'new' });
		expect(scrollCalls).toHaveLength(1);

		setReveal({ line: 2, requestId: 2, side: 'new' });

		expect(scrollCalls).toHaveLength(2);
	});

	test('does not scroll again when the request is unchanged', () => {
		const { setReveal } = renderViewer({ line: 2, requestId: 1, side: 'new' });
		expect(scrollCalls).toHaveLength(1);

		setReveal({ line: 2, requestId: 1, side: 'new' });

		expect(scrollCalls).toHaveLength(1);
	});

	test('drops the flash after its window, leaving no timer behind', () => {
		vi.useFakeTimers();
		try {
			const { container } = renderViewer({
				line: 2,
				requestId: 1,
				side: 'new',
			});
			expect(
				container.querySelector('.diff-code-selected, .diff-gutter-selected'),
			).not.toBeNull();

			act(() => {
				vi.advanceTimersByTime(2_000);
			});

			expect(
				container.querySelector('.diff-code-selected, .diff-gutter-selected'),
			).toBeNull();
			expect(vi.getTimerCount()).toBe(0);
		} finally {
			vi.useRealTimers();
		}
	});

	test('expands to the whole file to reach a line the diff never touched', () => {
		const { getByRole } = renderViewer(
			{ line: 7, requestId: 1, side: 'new' },
			FULL_FILE,
		);

		expect(
			getByRole('button', { name: 'File' }).getAttribute('aria-pressed'),
		).toBe('true');
		expect(scrollCalls).toHaveLength(1);
	});

	// The panel cannot start the full-file query until the diff query has
	// resolved, and it mounts the viewer the moment that happens — so the source
	// is always absent on first paint. Giving up there would make the escalation
	// above unreachable in the app however well it tests in isolation.
	test('waits for a full-file source still in flight, then expands', () => {
		const { getByRole, landSource } = renderViewerAwaitingSource({
			line: 7,
			requestId: 1,
			side: 'new',
		});

		expect(scrollCalls).toHaveLength(0);

		landSource();

		expect(
			getByRole('button', { name: 'File' }).getAttribute('aria-pressed'),
		).toBe('true');
		expect(scrollCalls).toHaveLength(1);
	});

	// A commit-scope diff has no working-tree source to expand into, so the jump
	// gives up rather than looping on an escalation it can never satisfy.
	test('gives up quietly when the line is unreachable', () => {
		const { setReveal } = renderViewer({ line: 7, requestId: 1, side: 'new' });

		expect(scrollCalls).toHaveLength(0);

		setReveal({ line: 7, requestId: 1, side: 'new' });
		setReveal({ line: 7, requestId: 1, side: 'new' });

		expect(scrollCalls).toHaveLength(0);
	});

	test('stays put when nothing is pending', () => {
		renderViewer(null);

		expect(scrollCalls).toHaveLength(0);
	});

	test('reports a served request so its owner can drop it', () => {
		const settled = vi.fn();

		renderViewer({ line: 2, requestId: 7, side: 'new' }, undefined, settled);

		expect(settled).toHaveBeenCalledWith(7);
	});

	// Without the report the request outlives the panel, and the next mount of the
	// same file replays the jump out of nowhere.
	test('reports an unreachable request too', () => {
		const settled = vi.fn();

		renderViewer({ line: 7, requestId: 7, side: 'new' }, undefined, settled);

		expect(settled).toHaveBeenCalledWith(7);
	});

	test('reports nothing while the full-file source is still in flight', () => {
		const settled = vi.fn();
		const store = createStore();
		render(
			<Provider store={store}>
				<TooltipProvider>
					<DiffViewer
						filePath='f.ts'
						fullFileContent={null}
						fullFileContentPending
						onRevealSettled={settled}
						patch={PATCH}
						reveal={{ line: 7, requestId: 7, side: 'new' }}
					/>
				</TooltipProvider>
			</Provider>,
		);

		expect(settled).not.toHaveBeenCalled();
	});
});
