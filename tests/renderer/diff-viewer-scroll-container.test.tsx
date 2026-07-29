// @vitest-environment happy-dom

import { render } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import { describe, expect, test } from 'vitest';

import { DiffViewer } from '../../src/renderer/components/diff-viewer/diff-viewer';
import { TooltipProvider } from '../../src/renderer/components/ui/tooltip';
import { installLocalStorage } from './support/dom';

const RENAME_ONLY_PATCH = `diff --git a/old-name.ts b/new-name.ts
similarity index 100%
rename from old-name.ts
rename to new-name.ts
`;

const HUNK_PATCH = `diff --git a/f.ts b/f.ts
index 111..222 100644
--- a/f.ts
+++ b/f.ts
@@ -1,3 +1,4 @@
 keepA
+addedB
 keepC
 keepD
`;

/** Render DiffViewer inside the providers its toolbar and tooltips need. */
function renderViewer(props: { fillHeight?: boolean; patch: string }) {
	installLocalStorage();
	const store = createStore();
	return render(
		<Provider store={store}>
			<TooltipProvider>
				<DiffViewer
					fillHeight={props.fillHeight}
					filePath='new-name.ts'
					patch={props.patch}
				/>
			</TooltipProvider>
		</Provider>,
	);
}

describe('diff viewer scroll containers', () => {
	test('a rename-only diff falls back to the raw patch with no hunk table', () => {
		const { container } = renderViewer({ patch: RENAME_ONLY_PATCH });

		expect(container.querySelector('table')).toBeNull();
		expect(container.querySelector('pre')).not.toBeNull();
	});

	test('keeps a single scroll container around the fallback patch', () => {
		const { container } = renderViewer({ patch: RENAME_ONLY_PATCH });
		const scrollers = container.querySelectorAll('.overflow-auto');

		expect(scrollers.length).toBe(1);
	});

	test('constrains the fallback scroll container so its scrollbar stays pinned', () => {
		const { container } = renderViewer({ patch: RENAME_ONLY_PATCH });
		const scroller = container.querySelector('.overflow-auto');

		expect(scroller?.className).toContain('min-h-0');
		expect(scroller?.className).toContain('flex-1');
		expect(scroller?.querySelector('pre')).not.toBeNull();
	});

	test('keeps a single scroll container around a parsed hunk table', () => {
		const { container } = renderViewer({ patch: HUNK_PATCH });
		const scrollers = container.querySelectorAll('.overflow-auto');

		expect(scrollers.length).toBe(1);
		expect(scrollers[0].querySelector('table')).not.toBeNull();
	});

	test('leaves a content-sized viewer unconstrained when fillHeight is off', () => {
		const { container } = renderViewer({
			fillHeight: false,
			patch: RENAME_ONLY_PATCH,
		});
		const frame = container.firstElementChild;

		expect(frame?.className).not.toContain('flex-1');
		expect(container.querySelectorAll('.overflow-auto').length).toBe(1);
	});
});
