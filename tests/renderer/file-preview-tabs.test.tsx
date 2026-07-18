// @vitest-environment happy-dom

import { act, fireEvent, screen } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import { describe, expect, test, vi } from 'vitest';

vi.mock('@iconify/react', () => ({
	addCollection: () => undefined,
	Icon: ({ icon }: { icon: string }) => <span data-icon={icon} />,
}));

// @ts-expect-error Vitest resolves the app alias for the component-under-test atom identity.
import { developerModeAtom } from '@/renderer/state/preferences';
import { ensemblrQueryKeys } from '../../src/renderer/api/ensemblr-queries';
import { FilePreviewPanel } from '../../src/renderer/components/workbench-shell/conversation-panel/file-preview-panel';
import { SessionTabs } from '../../src/renderer/components/workbench-shell/conversation-panel/session-tabs';
import { getWorkspaceFileIconNameForPath } from '../../src/renderer/lib/workbench';
import type { SessionTabModel } from '../../src/renderer/types/workbench';
import { createTestQueryClient, renderWithProviders } from './support/dom';

const workspaceCwd = '/workspace/ensemblr';
const previewFilePath = 'assets/logo.png';
const previewImageContent = 'iVBORw0KGgo=';

const previewSession: SessionTabModel = {
	chatTabId: 'preview-tab',
	filePath: previewFilePath,
	id: 'preview-tab',
	kind: 'preview',
	label: 'logo.png',
	piSessionId: null,
	status: 'idle',
	summary: '',
	turnId: null,
	updatedLabel: 'logo.png',
};

describe('file preview tabs', () => {
	test('maps TypeScript modules and runtime rc files to specific icons', () => {
		expect(getWorkspaceFileIconNameForPath('vite.config.mts')).toBe(
			'vscode-icons:file-type-typescript',
		);
		expect(getWorkspaceFileIconNameForPath('.npmrc')).toBe(
			'vscode-icons:file-type-npm',
		);
		expect(getWorkspaceFileIconNameForPath('packages/app/.nvmrc')).toBe(
			'vscode-icons:file-type-node',
		);
	});

	test('uses a file-type icon for file preview tabs', () => {
		const { container } = renderWithProviders(
			<SessionTabs
				activeSession={previewSession}
				closedSessions={[]}
				onSessionTabChange={() => undefined}
				onSessionTabClose={() => undefined}
				onSessionTabOpen={async () => null}
				onSessionTabRestore={() => undefined}
				onSessionTabsReorder={() => undefined}
				sessions={[previewSession]}
			/>,
		);

		expect(
			container.querySelector('[data-icon="vscode-icons:file-type-image"]'),
		).toBeTruthy();
		expect(
			container.querySelector('[data-session-tab-reorderable="false"]'),
		).toBeTruthy();
		expect(
			screen.queryByRole('button', { name: 'Show Pi debug panel' }),
		).toBeNull();
	});

	test('exposes the Pi debug button when developer mode is enabled', () => {
		const store = createStore();

		renderWithProviders(
			<Provider store={store}>
				<SessionTabs
					activeSession={previewSession}
					closedSessions={[]}
					onSessionTabChange={() => undefined}
					onSessionTabClose={() => undefined}
					onSessionTabOpen={async () => null}
					onSessionTabRestore={() => undefined}
					onSessionTabsReorder={() => undefined}
					sessions={[previewSession]}
				/>
			</Provider>,
		);

		act(() => {
			store.set(developerModeAtom, true);
		});

		expect(
			screen.queryByRole('button', { name: 'Show Pi debug panel' }),
		).toBeTruthy();
	});

	test('renders base64 image previews instead of source code blocks', () => {
		const client = createTestQueryClient();
		client.setQueryData(
			ensemblrQueryKeys.filePreview(workspaceCwd, previewFilePath),
			{
				content: previewImageContent,
				contentEncoding: 'base64',
				mimeType: 'image/png',
				path: previewFilePath,
				sizeBytes: 8,
			},
		);

		const { container } = renderWithProviders(
			<FilePreviewPanel
				filePath={previewFilePath}
				workspaceCwd={workspaceCwd}
			/>,
			{ client },
		);

		const image = screen.getByRole('img', {
			name: `Preview of ${previewFilePath}`,
		});

		expect(image.getAttribute('src')).toBe(
			`data:image/png;base64,${previewImageContent}`,
		);
		expect(
			container.querySelector('[data-icon="vscode-icons:file-type-image"]'),
		).toBeTruthy();
	});
});

const chatA: SessionTabModel = {
	chatTabId: 'chat-a',
	id: 'chat-a',
	kind: 'chat',
	label: 'Chat A',
	piSessionId: null,
	status: 'idle',
	summary: '',
	turnId: null,
	updatedLabel: '',
};
const chatB: SessionTabModel = {
	...chatA,
	chatTabId: 'chat-b',
	id: 'chat-b',
	label: 'Chat B',
};

describe('session tab close controls', () => {
	test('marks the active tab and closes a tab on close-button click', () => {
		const onSessionTabClose = vi.fn();

		renderWithProviders(
			<SessionTabs
				activeSession={chatA}
				closedSessions={[]}
				onSessionTabChange={() => undefined}
				onSessionTabClose={onSessionTabClose}
				onSessionTabOpen={async () => null}
				onSessionTabRestore={() => undefined}
				onSessionTabsReorder={() => undefined}
				sessions={[chatA, chatB]}
			/>,
		);

		expect(
			screen
				.getByText('Chat A')
				.closest('button')
				?.getAttribute('aria-current'),
		).toBe('page');
		expect(
			screen
				.getByText('Chat B')
				.closest('button')
				?.getAttribute('aria-current'),
		).toBeNull();

		fireEvent.click(screen.getByRole('button', { name: 'Close Chat B tab' }));

		expect(onSessionTabClose).toHaveBeenCalledWith('chat-b');
	});

	test('hides the close control for a lone chat tab', () => {
		renderWithProviders(
			<SessionTabs
				activeSession={chatA}
				closedSessions={[]}
				onSessionTabChange={() => undefined}
				onSessionTabClose={() => undefined}
				onSessionTabOpen={async () => null}
				onSessionTabRestore={() => undefined}
				onSessionTabsReorder={() => undefined}
				sessions={[chatA]}
			/>,
		);

		expect(screen.queryByRole('button', { name: /Close .* tab/ })).toBeNull();
	});

	test('keeps the close control for a lone non-chat tab', () => {
		renderWithProviders(
			<SessionTabs
				activeSession={previewSession}
				closedSessions={[]}
				onSessionTabChange={() => undefined}
				onSessionTabClose={() => undefined}
				onSessionTabOpen={async () => null}
				onSessionTabRestore={() => undefined}
				onSessionTabsReorder={() => undefined}
				sessions={[previewSession]}
			/>,
		);

		expect(
			screen.getByRole('button', { name: `Close ${previewSession.label} tab` }),
		).toBeTruthy();
	});
});
