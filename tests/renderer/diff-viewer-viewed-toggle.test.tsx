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

const PATCH = `diff --git a/first.ts b/first.ts
index 111..222 100644
--- a/first.ts
+++ b/first.ts
@@ -1,3 +1,4 @@
 export const x = 1;
+export const y = 2;
 const z = x + 1;
 console.log(z);
`;

function renderViewer(props: {
	onViewedChange?: (viewed: boolean) => void;
	viewed?: boolean;
}) {
	const store = createStore();
	return render(
		<Provider store={store}>
			<TooltipProvider>
				<DiffViewer filePath='first.ts' patch={PATCH} {...props} />
			</TooltipProvider>
		</Provider>,
	);
}

function viewedCheckbox(container: HTMLElement) {
	return container.querySelector('[role="checkbox"]');
}

describe('mark as viewed', () => {
	test('the toolbar offers a labeled checkbox when the caller tracks it', () => {
		const { container } = renderViewer({ onViewedChange: () => undefined });
		const checkbox = viewedCheckbox(container);

		expect(checkbox?.getAttribute('aria-checked')).toBe('false');
		expect(
			container.querySelector(`label[for="${checkbox?.id}"]`)?.textContent,
		).toContain('Viewed');
	});

	test('a viewer with nothing tracking review state hides the checkbox', () => {
		const { container } = renderViewer({});

		expect(viewedCheckbox(container)).toBeNull();
	});

	test('checking it reports the state the click moves to, in both directions', () => {
		const onViewedChange = vi.fn();
		const unmarked = renderViewer({ onViewedChange });
		fireEvent.click(viewedCheckbox(unmarked.container) as Element);
		expect(onViewedChange).toHaveBeenLastCalledWith(true);

		const marked = renderViewer({ onViewedChange, viewed: true });
		const checkbox = viewedCheckbox(marked.container) as Element;
		expect(checkbox.getAttribute('aria-checked')).toBe('true');

		fireEvent.click(checkbox);
		expect(onViewedChange).toHaveBeenLastCalledWith(false);
	});
});
