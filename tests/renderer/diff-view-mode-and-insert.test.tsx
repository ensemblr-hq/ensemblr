// @vitest-environment happy-dom
import { fireEvent, render, renderHook } from '@testing-library/react';
import { createStore, Provider, useAtom } from 'jotai';
import type { ReactNode } from 'react';
import { describe, expect, test } from 'vitest';

import { DiffViewer } from '../../src/renderer/components/diff-viewer/diff-viewer';
import { TooltipProvider } from '../../src/renderer/components/ui/tooltip';
import { diffNewSideIsWorkingTree } from '../../src/renderer/components/workbench-shell/conversation-panel/workspace-file-diff-panel';
import {
	composerValueAtomFamily,
	useComposerInsertToChat,
} from '../../src/renderer/state/composer';

const PATCH = `diff --git a/f.ts b/f.ts
index 111..222 100644
--- a/f.ts
+++ b/f.ts
@@ -5,4 +5,6 @@ export const x = 1;
 };

 export type TrailMap = {
+	title: string;
+	region: string;
 	stops: TrailStop[];
 };
`;

const FULL = `line1
line2
line3
line4
};

export type TrailMap = {
	title: string;
	region: string;
	stops: TrailStop[];
};
last`;

/** Render DiffViewer inside the providers its toolbar and tooltips need. */
function renderViewer(props: { fullFileContent?: string | null }) {
	const store = createStore();
	return render(
		<Provider store={store}>
			<TooltipProvider>
				<DiffViewer
					filePath='f.ts'
					fullFileContent={props.fullFileContent ?? null}
					onAddComment={() => {}}
					patch={PATCH}
				/>
			</TooltipProvider>
		</Provider>,
	);
}

describe('diff view-mode segmented control (issue 1)', () => {
	test('shows both Diff and File buttons, and switches both directions', () => {
		const { container, getByRole } = renderViewer({ fullFileContent: FULL });
		const diffBtn = getByRole('button', { name: 'Diff' });
		const fileBtn = getByRole('button', { name: 'File' });
		expect(diffBtn).toBeInTheDocument();
		expect(fileBtn).toBeInTheDocument();
		expect(fileBtn).not.toBeDisabled();
		expect(diffBtn.getAttribute('aria-pressed')).toBe('true');

		const diffRows = container.querySelectorAll('tr').length;
		fireEvent.click(fileBtn);
		expect(fileBtn.getAttribute('aria-pressed')).toBe('true');
		expect(container.querySelectorAll('tr').length).toBeGreaterThan(diffRows);

		// The Diff button is still present to switch back — the reported "no button
		// to return to the diff" case.
		fireEvent.click(getByRole('button', { name: 'Diff' }));
		expect(
			getByRole('button', { name: 'Diff' }).getAttribute('aria-pressed'),
		).toBe('true');
		expect(container.querySelectorAll('tr').length).toBe(diffRows);
	});

	test('File is disabled when no full-file source is available', () => {
		const { getByRole } = renderViewer({ fullFileContent: null });
		expect(getByRole('button', { name: 'File' })).toBeDisabled();
	});
});

const TWO_HUNK_PATCH = `diff --git a/f.ts b/f.ts
index 111..222 100644
--- a/f.ts
+++ b/f.ts
@@ -8,4 +8,3 @@ header
 keepA
 keepB
-dropped
 keepC
@@ -32,3 +31,4 @@ header
 keepD
+addedE
 keepF
 keepG
`;

describe('hunk gap separators', () => {
	test('renders one gap band between two far-apart hunks, with a count', () => {
		const store = createStore();
		const { container } = render(
			<Provider store={store}>
				<TooltipProvider>
					<DiffViewer filePath='f.ts' patch={TWO_HUNK_PATCH} />
				</TooltipProvider>
			</Provider>,
		);
		const gaps = container.querySelectorAll('.ensemblr-diff-gap');
		expect(gaps.length).toBe(1);
		// old side: first hunk covers 8..11, second starts at 32 → 32-12 = 20 hidden.
		expect(gaps[0].textContent).toContain('20 unchanged lines');
	});
});

describe('diffNewSideIsWorkingTree — full-file availability by scope', () => {
	test('working-tree, branch, and default scopes can read the full file', () => {
		expect(diffNewSideIsWorkingTree(undefined)).toBe(true);
		expect(diffNewSideIsWorkingTree({ kind: 'working-tree' })).toBe(true);
		expect(diffNewSideIsWorkingTree({ baseRef: 'main', kind: 'branch' })).toBe(
			true,
		);
	});

	test('commit scope cannot (new side is a historical ref)', () => {
		expect(
			diffNewSideIsWorkingTree({ commitHash: 'abc1234', kind: 'commit' }),
		).toBe(false);
	});
});

describe('useComposerInsertToChat (issue 3)', () => {
	test('appends diff text onto the chosen chat draft, not the active one', () => {
		const store = createStore();
		const wrapper = ({ children }: { children: ReactNode }) => (
			<Provider store={store}>{children}</Provider>
		);
		const { result } = renderHook(() => useComposerInsertToChat(), { wrapper });

		result.current('chat-b', 'DIFF CONTEXT');

		const readB = renderHook(() => useAtom(composerValueAtomFamily('chat-b')), {
			wrapper,
		});
		const readA = renderHook(() => useAtom(composerValueAtomFamily('chat-a')), {
			wrapper,
		});
		expect(readB.result.current[0]).toBe('DIFF CONTEXT');
		expect(readA.result.current[0]).toBe('');

		result.current('chat-b', 'SECOND');
		const readB2 = renderHook(
			() => useAtom(composerValueAtomFamily('chat-b')),
			{
				wrapper,
			},
		);
		expect(readB2.result.current[0]).toBe('DIFF CONTEXT\n\nSECOND');
	});
});
