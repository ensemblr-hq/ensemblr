// @vitest-environment happy-dom

import { screen } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import { describe, expect, test, vi } from 'vitest';

vi.mock('@iconify/react', () => ({
	addCollection: () => undefined,
	Icon: ({ icon }: { icon: string }) => <span data-icon={icon} />,
}));

import { ensemblrQueryKeys } from '../../src/renderer/api/ensemblr-queries';
import { FilePreviewPanel } from '../../src/renderer/components/workbench-shell/conversation-panel/file-preview-panel';
import { SessionTabs } from '../../src/renderer/components/workbench-shell/conversation-panel/session-tabs';
import { getWorkspaceFileIconNameForPath } from '../../src/renderer/lib/workbench';
import { developerModeAtom } from '../../src/renderer/state/preferences';
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
		store.set(developerModeAtom, true);

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
