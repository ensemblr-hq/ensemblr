// @vitest-environment happy-dom

import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createStore, Provider } from 'jotai';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('@iconify/react', () => ({
	addCollection: () => undefined,
	Icon: ({ icon }: { icon: string }) => <span data-icon={icon} />,
}));

import { ConciergeTimeline } from '@/renderer/components/concierge/concierge-timeline';
import { WorkbenchLayoutModelProvider } from '@/renderer/components/workbench-shell/shell-contexts';
import { conciergePresentationAtom } from '@/renderer/state/concierge';
import type {
	ProjectShellModel,
	WorkspaceShellModel,
} from '@/renderer/types/workbench';
import type { WorkbenchLayoutModel } from '@/renderer/types/workbench-shell';
import type { ConciergeSessionEventWire } from '@/shared/ipc/contracts/concierge';

import {
	clearEnsemblrApi,
	createTestQueryClient,
	installEnsemblrApi,
} from '../support/dom';

const ROOT = '/Users/dev/Ensemblr';
const WORKTREE = `${ROOT}/workspaces/app/bruckner`;

const PROJECTS = [
	{
		id: 'app',
		name: 'app',
		pathLabel: `${ROOT}/repos/app`,
		workspaces: [
			{
				id: 'bruckner',
				name: 'bruckner',
				pathLabel: WORKTREE,
			} as WorkspaceShellModel,
		],
	} as ProjectShellModel,
];

const navigateToWorkspace = vi.fn();
const openChatTab = vi.fn();

const layoutModel = {
	displayProjects: PROJECTS,
	navigateToWorkspace,
	resolveWorkspaceRouteSearch: () => ({ dock: 'setup', review: 'files' }),
} as unknown as WorkbenchLayoutModel;

/** One assistant answer, as the Concierge's transcript stores it. */
function answer(text: string): ConciergeSessionEventWire {
	return {
		createdAt: '2026-08-24T12:00:00.000Z',
		eventType: 'message',
		id: 'evt-1',
		ordinal: 1,
		payload: {
			kind: 'message',
			payload: { kind: 'text', text },
			role: 'agent',
		},
		sessionId: 'concierge-1',
		stream: 'protocol',
	};
}

/** Mounts the transcript with the shell's projects behind it. */
function renderTimeline(text: string, store = createStore()) {
	return render(
		<Provider store={store}>
			<QueryClientProvider client={createTestQueryClient()}>
				<WorkbenchLayoutModelProvider value={layoutModel}>
					<ConciergeTimeline
						centered={false}
						events={[answer(text)]}
						isStreaming={false}
					/>
				</WorkbenchLayoutModelProvider>
			</QueryClientProvider>
		</Provider>,
	);
}

beforeEach(() => {
	navigateToWorkspace.mockReset();
	openChatTab.mockReset();
	openChatTab.mockResolvedValue({ tab: { id: 'tab-file-1' } });
	installEnsemblrApi({ openChatTab });
});

afterEach(() => {
	clearEnsemblrApi();
});

describe('file chips in the Concierge transcript', () => {
	test('opens a worktree file in the workspace that holds it', async () => {
		renderTimeline(`Start at \`${WORKTREE}/src/main/main.ts\`.`);

		await userEvent.click(screen.getByRole('button', { name: /main\.ts/ }));

		await waitFor(() => {
			expect(openChatTab).toHaveBeenCalledWith({
				kind: 'file',
				metadata: { filePath: 'src/main/main.ts' },
				preview: true,
				title: 'main.ts',
				workspaceId: 'bruckner',
			});
		});
		expect(navigateToWorkspace).toHaveBeenCalledWith(
			'app',
			'bruckner',
			'tab-file-1',
		);
	});

	// Maximized, the panel covers the whole content area — including the preview
	// the click just opened.
	test('puts a maximized panel back in its card on the way out', async () => {
		const store = createStore();
		store.set(conciergePresentationAtom, 'fullscreen');
		renderTimeline(`See \`${WORKTREE}/README.md\`.`, store);

		await userEvent.click(screen.getByRole('button', { name: /README\.md/ }));

		await waitFor(() => {
			expect(store.get(conciergePresentationAtom)).toBe('panel');
		});
	});

	test('leaves a bare filename as prose, which names no project', () => {
		renderTimeline('Every project has a `README.md`.');

		expect(screen.queryByRole('button', { name: /README\.md/ })).toBeNull();
		expect(openChatTab).not.toHaveBeenCalled();
	});
});
