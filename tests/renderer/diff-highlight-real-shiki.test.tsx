// @vitest-environment happy-dom
import { render, waitFor } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import { describe, expect, test } from 'vitest';

import { DiffViewer } from '../../src/renderer/components/diff-viewer/diff-viewer';
import { TooltipProvider } from '../../src/renderer/components/ui/tooltip';

// Regression: the shared highlighter runs Shiki in dual-theme mode, so tokens
// carry their color in `htmlStyle.color`, not the top-level `color` field. The
// diff tokenizer previously read only `token.color`, leaving every diff line
// un-highlighted. This exercises the real Shiki path end to end.
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

describe('diff highlighting with the real Shiki highlighter', () => {
	test('renders colored syntax spans from dual-theme tokens', async () => {
		const store = createStore();
		const { container } = render(
			<Provider store={store}>
				<TooltipProvider>
					<DiffViewer filePath='f.ts' patch={PATCH} />
				</TooltipProvider>
			</Provider>,
		);

		await waitFor(
			() => {
				const colored = container.querySelectorAll('span[style*="color"]');
				expect(colored.length).toBeGreaterThan(0);
			},
			{ timeout: 8000 },
		);
	}, 12000);
});
