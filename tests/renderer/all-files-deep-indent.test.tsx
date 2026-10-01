// @vitest-environment happy-dom

import { act, screen, waitFor } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { ensemblrQueryKeys } from '../../src/renderer/api/ensemblr';
import { ReviewFilePreviewOpenerProvider } from '../../src/renderer/components/workbench-shell/conversation-panel/file-preview-context';
import { AllFilesList } from '../../src/renderer/components/workbench-shell/review-files/all-files-list';
import { workspaceDirectoryRevealRequestAtom } from '../../src/renderer/state/workspace';
import type { WorkspaceFileSummary } from '../../src/renderer/types/workbench';
import { createTestQueryClient, renderWithProviders } from './support/dom';

vi.mock('@tanstack/react-virtual', () => ({
	useVirtualizer: ({ count }: { count: number }) => ({
		getTotalSize: () => count * 28,
		getVirtualItems: () =>
			Array.from({ length: count }, (_, index) => ({
				index,
				key: index,
				size: 28,
				start: index * 28,
			})),
		scrollToIndex: () => undefined,
	}),
}));

function installLocalStorage(): void {
	const items = new Map<string, string>();
	const storage: Storage = {
		clear: () => items.clear(),
		getItem: (key) => items.get(key) ?? null,
		key: (index) => Array.from(items.keys())[index] ?? null,
		get length() {
			return items.size;
		},
		removeItem: (key) => {
			items.delete(key);
		},
		setItem: (key, value) => {
			items.set(key, value);
		},
	};
	Object.defineProperty(window, 'localStorage', {
		configurable: true,
		value: storage,
	});
}

function directory(path: string): WorkspaceFileSummary {
	return {
		id: path,
		kind: 'directory',
		name: path.split('/').at(-1) ?? path,
		path,
	};
}

function file(path: string): WorkspaceFileSummary {
	return { id: path, kind: 'file', name: path.split('/').at(-1) ?? path, path };
}

const SCREENSHOTS = 'docs/media/gnome/screenshots';

// Mirrors the reported layout: siblings at every level keep each folder from
// compacting, so every directory below `docs` is its own row one level deeper.
const files: WorkspaceFileSummary[] = [
	directory('docs'),
	file('docs/README.md'),
	directory('docs/media'),
	file('docs/media/index.md'),
	directory('docs/media/gnome'),
	file('docs/media/gnome/README.md'),
	directory(SCREENSHOTS),
	directory(`${SCREENSHOTS}/gtk`),
	directory(`${SCREENSHOTS}/gtk/dark`),
	file(`${SCREENSHOTS}/gtk/dark/picker.png`),
	directory(`${SCREENSHOTS}/gtk/light`),
	file(`${SCREENSHOTS}/gtk/light/picker.png`),
	directory(`${SCREENSHOTS}/shell`),
	directory(`${SCREENSHOTS}/shell/dark`),
	file(`${SCREENSHOTS}/shell/dark/picker.png`),
	directory(`${SCREENSHOTS}/shell/light`),
	file(`${SCREENSHOTS}/shell/light/picker.png`),
];

/** Reads how many spacing steps of left padding a rendered row carries. */
function indentSteps(element: HTMLElement): number {
	const match = /\*\s*(\d+)/.exec(element.style.paddingLeft);
	return match ? Number(match[1]) : 0;
}

/** Renders the All files tree over a fresh Jotai store and returns that store. */
function renderAllFiles() {
	const client = createTestQueryClient();
	client.setQueryData(ensemblrQueryKeys.workspaceOpenTargets(), {
		targets: [],
	});
	const store = createStore();
	renderWithProviders(
		<Provider store={store}>
			<ReviewFilePreviewOpenerProvider value={vi.fn()}>
				<AllFilesList
					files={files}
					workspaceCwd='/repo'
					workspaceId='workspace-1'
				/>
			</ReviewFilePreviewOpenerProvider>
		</Provider>,
		{ client },
	);
	return store;
}

describe('All files deep indentation', () => {
	beforeEach(() => {
		installLocalStorage();
	});

	test('indents every level past the fourth one step further than its parent', async () => {
		const store = renderAllFiles();

		act(() => {
			store.set(workspaceDirectoryRevealRequestAtom, {
				exclusive: false,
				id: 1,
				path: `${SCREENSHOTS}/gtk/dark`,
				workspaceId: 'workspace-1',
			});
		});

		const darkFolder = await waitFor(() =>
			screen.getByRole('treeitem', {
				name: `Collapse ${SCREENSHOTS}/gtk/dark`,
			}),
		);
		const chain = [
			screen.getByRole('treeitem', { name: 'Collapse docs' }),
			screen.getByRole('treeitem', { name: 'Collapse docs/media' }),
			screen.getByRole('treeitem', { name: 'Collapse docs/media/gnome' }),
			screen.getByRole('treeitem', { name: `Collapse ${SCREENSHOTS}` }),
			screen.getByRole('treeitem', { name: `Collapse ${SCREENSHOTS}/gtk` }),
			darkFolder,
			screen.getByRole('treeitem', {
				name: `Open ${SCREENSHOTS}/gtk/dark/picker.png preview`,
			}),
		];

		expect(chain.map((row) => row.getAttribute('aria-level'))).toEqual([
			'1',
			'2',
			'3',
			'4',
			'5',
			'6',
			'7',
		]);
		expect(chain.map(indentSteps)).toEqual([0, 6, 10, 14, 18, 22, 26]);
	});

	test('keeps a level-5 folder indented past its level-4 sibling', async () => {
		const store = renderAllFiles();

		act(() => {
			store.set(workspaceDirectoryRevealRequestAtom, {
				exclusive: false,
				id: 1,
				path: `${SCREENSHOTS}/gtk`,
				workspaceId: 'workspace-1',
			});
		});

		const gtkDark = await waitFor(() =>
			screen.getByRole('treeitem', {
				name: `Expand ${SCREENSHOTS}/gtk/dark`,
			}),
		);
		const shell = screen.getByRole('treeitem', {
			name: `Expand ${SCREENSHOTS}/shell`,
		});

		expect(indentSteps(gtkDark)).toBeGreaterThan(indentSteps(shell));
	});
});
