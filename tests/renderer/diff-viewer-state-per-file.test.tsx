// @vitest-environment happy-dom
import { fireEvent, render } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import { describe, expect, test, vi } from 'vitest';

vi.mock('../../src/renderer/components/code-block', () => ({
	CodeBlockContent: () => null,
}));
vi.mock('../../src/renderer/lib/code/highlighter', () => ({
	highlightCode: () => null,
}));

import { DiffViewer } from '../../src/renderer/components/diff-viewer/diff-viewer';
import { TooltipProvider } from '../../src/renderer/components/ui/tooltip';

const FIRST_PATCH = `diff --git a/first.ts b/first.ts
index 111..222 100644
--- a/first.ts
+++ b/first.ts
@@ -1,3 +1,4 @@
 export const x = 1;
+export const y = 2;
 const z = x + 1;
 console.log(z);
`;

// A second file whose inserted line lands on the same line number as the first
// file's, so the change key the composer anchors to exists in both patches.
const SECOND_PATCH = `diff --git a/second.ts b/second.ts
index 333..444 100644
--- a/second.ts
+++ b/second.ts
@@ -1,3 +1,4 @@
 export const a = 1;
+export const b = 2;
 const c = a + 1;
 console.log(c);
`;

const THIRD_PATCH = `diff --git a/third.ts b/third.ts
index 555..666 100644
--- a/third.ts
+++ b/third.ts
@@ -1,3 +1,4 @@
 export const p = 1;
+export const q = 2;
 const r = p + 1;
 console.log(r);
`;

function hoverRow(row: Element) {
	for (const cell of row.querySelectorAll('.diff-gutter, .diff-code')) {
		fireEvent.mouseEnter(cell);
	}
}

function renderViewer(filePath: string, patch: string) {
	const store = createStore();
	const ui = (props: { filePath: string; patch: string }) => (
		<Provider store={store}>
			<TooltipProvider>
				<DiffViewer
					filePath={props.filePath}
					onAddComment={() => undefined}
					patch={props.patch}
				/>
			</TooltipProvider>
		</Provider>
	);
	const result = render(ui({ filePath, patch }));
	return {
		...result,
		showFile: (next: { filePath: string; patch: string }) =>
			result.rerender(ui(next)),
	};
}

function openComposerOnFirstRow(container: HTMLElement) {
	const row = container.querySelector('.diff-line') as Element;
	hoverRow(row);
	fireEvent.click(row.querySelector('button') as HTMLButtonElement);
}

describe('diff viewer state belongs to the file it was opened on', () => {
	test('an open composer does not follow a switch to another file', () => {
		const { container, showFile } = renderViewer('first.ts', FIRST_PATCH);
		openComposerOnFirstRow(container);
		expect(container.querySelector('textarea')).not.toBeNull();

		showFile({ filePath: 'second.ts', patch: SECOND_PATCH });

		expect(container.querySelector('textarea')).toBeNull();
	});

	test('each file keeps its own composer, whichever was visited between', () => {
		const { container, showFile } = renderViewer('first.ts', FIRST_PATCH);
		openComposerOnFirstRow(container);

		showFile({ filePath: 'second.ts', patch: SECOND_PATCH });
		expect(container.querySelector('textarea')).toBeNull();

		openComposerOnFirstRow(container);
		showFile({ filePath: 'third.ts', patch: THIRD_PATCH });
		expect(container.querySelector('textarea')).toBeNull();

		showFile({ filePath: 'first.ts', patch: FIRST_PATCH });
		expect(container.querySelector('textarea')).not.toBeNull();
	});

	test('the view mode does not follow a switch to another file', () => {
		const fullFile = 'export const x = 1;\nconst z = x + 1;\nconsole.log(z);\n';
		const store = createStore();
		const ui = (props: { filePath: string; patch: string }) => (
			<Provider store={store}>
				<TooltipProvider>
					<DiffViewer
						filePath={props.filePath}
						fullFileContent={fullFile}
						patch={props.patch}
					/>
				</TooltipProvider>
			</Provider>
		);
		const { container, rerender } = render(
			ui({ filePath: 'first.ts', patch: FIRST_PATCH }),
		);
		const fileToggle = () =>
			container.querySelector('button[aria-label="File"]') as HTMLButtonElement;

		fireEvent.click(fileToggle());
		expect(fileToggle().getAttribute('aria-pressed')).toBe('true');

		rerender(ui({ filePath: 'second.ts', patch: SECOND_PATCH }));

		expect(fileToggle().getAttribute('aria-pressed')).toBe('false');
	});
});
