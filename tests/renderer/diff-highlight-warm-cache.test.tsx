// @vitest-environment happy-dom
import { render } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import { describe, expect, test, vi } from 'vitest';

// Simulate a warm Shiki highlighter: the first call for a given text (the
// render-time useMemo) misses and returns null; the next call for that text
// (the effect) hits the cache and returns tokens synchronously WITHOUT invoking
// the callback. This is the exact shape that left the diff un-highlighted.
const seen = new Set<string>();
vi.mock('../../src/renderer/components/code-block', () => ({
	CodeBlockContent: () => null,
	highlightCode: (code: string) => {
		if (!seen.has(code)) {
			seen.add(code);
			return null;
		}
		return {
			bg: 'transparent',
			fg: 'inherit',
			tokens: code
				.split('\n')
				.map((line) =>
					line === ''
						? []
						: [{ color: '#ff8800', content: line, fontStyle: 0 }],
				),
		};
	},
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

describe('diff highlighting survives a warm highlighter cache', () => {
	test('renders colored syntax spans even when tokens arrive only via the sync return', async () => {
		const store = createStore();
		const { container, findAllByText } = render(
			<Provider store={store}>
				<TooltipProvider>
					<DiffViewer filePath='f.ts' patch={PATCH} />
				</TooltipProvider>
			</Provider>,
		);
		// Let the effect run and flush its setState.
		await findAllByText(/export/);
		const colored = container.querySelectorAll('span[style*="color"]');
		expect(colored.length).toBeGreaterThan(0);
	});
});
