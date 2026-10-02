// @vitest-environment happy-dom

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { act, fireEvent, screen } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('@iconify/react', () => ({
	addCollection: () => undefined,
	Icon: ({ icon }: { icon: string }) => <span data-icon={icon} />,
}));

import { developerModeAtom } from '@/renderer/state/preferences';
import { ensemblrQueryKeys } from '../../src/renderer/api/ensemblr-queries';
import { FilePreviewPanel } from '../../src/renderer/components/workbench-shell/conversation-panel/file-preview-panel';
import { SessionTabs } from '../../src/renderer/components/workbench-shell/conversation-panel/session-tabs';
import { getWorkspaceFileIconNameForPath } from '../../src/renderer/lib/workbench';
import type { SessionTabModel } from '../../src/renderer/types/workbench';
import { DEFAULT_APP_SETTINGS } from '../../src/shared/config';
import {
	createTestQueryClient,
	installEnsemblrApi,
	installLocalStorage,
	renderWithProviders,
} from './support/dom';

beforeEach(() => {
	installLocalStorage();
	installEnsemblrApi({
		getAppSettings: async () => DEFAULT_APP_SETTINGS,
		updateAppSettings: async () => DEFAULT_APP_SETTINGS,
	});
});

const workspaceCwd = '/workspace/ensemblr';
const previewFilePath = 'assets/logo.png';
const previewImageContent = 'iVBORw0KGgo=';

const LANGUAGE_FROM_PATH = join(
	process.cwd(),
	'src/renderer/lib/language-from-path.ts',
);

function listHighlightedExtensions(): string[] {
	const source = readFileSync(LANGUAGE_FROM_PATH, 'utf8');
	const table = source.slice(
		source.indexOf('const EXTENSION_LANGUAGE'),
		source.indexOf('const BASENAME_LANGUAGE'),
	);
	return [...table.matchAll(/^\t([a-z0-9]+):/gm)].map((match) => match[1]);
}

const previewSession: SessionTabModel = {
	chatTabId: 'preview-tab',
	filePath: previewFilePath,
	id: 'preview-tab',
	isPreview: false,
	isSubAgent: false,
	kind: 'preview',
	label: 'logo.png',
	agentSessionId: null,
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

	test('maps Swift sources to the Swift icon', () => {
		expect(getWorkspaceFileIconNameForPath('Sources/App/Main.swift')).toBe(
			'vscode-icons:file-type-swift',
		);
		expect(getWorkspaceFileIconNameForPath('Package.swift')).toBe(
			'vscode-icons:file-type-swift',
		);
	});

	test('gives every syntax-highlighted extension an icon of its own', () => {
		const unmapped = listHighlightedExtensions().filter(
			(extension) =>
				getWorkspaceFileIconNameForPath(`sample.${extension}`) ===
				'vscode-icons:default-file',
		);

		expect(unmapped).toEqual([]);
	});

	test('maps Apple toolchain resources alongside their Swift sources', () => {
		expect(getWorkspaceFileIconNameForPath('App/Info.plist')).toBe(
			'vscode-icons:file-type-xml',
		);
		expect(getWorkspaceFileIconNameForPath('App/App.entitlements')).toBe(
			'vscode-icons:file-type-xml',
		);
		expect(getWorkspaceFileIconNameForPath('App/Main.storyboard')).toBe(
			'vscode-icons:file-type-storyboard',
		);
		expect(getWorkspaceFileIconNameForPath('App/LaunchScreen.xib')).toBe(
			'vscode-icons:file-type-xib',
		);
		expect(getWorkspaceFileIconNameForPath('Legacy/AppDelegate.m')).toBe(
			'vscode-icons:file-type-objectivec',
		);
		expect(getWorkspaceFileIconNameForPath('Legacy/Bridge.mm')).toBe(
			'vscode-icons:file-type-objectivecpp',
		);
	});

	test('uses a file-type icon for file preview tabs', () => {
		const { container } = renderWithProviders(
			<SessionTabs
				activeSession={previewSession}
				closedSessions={[]}
				onLaunchHarness={async () => null}
				onOpenArchitectureDiagram={async () => null}
				onSessionTabChange={() => undefined}
				onSessionTabClose={() => undefined}
				onSessionTabOpen={async () => null}
				onSessionTabPin={() => undefined}
				onSessionTabRestore={() => undefined}
				onSessionTabsReorder={() => undefined}
				sessions={[previewSession]}
				unreadKeys={new Set()}
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
					onLaunchHarness={async () => null}
					onOpenArchitectureDiagram={async () => null}
					onSessionTabChange={() => undefined}
					onSessionTabClose={() => undefined}
					onSessionTabOpen={async () => null}
					onSessionTabPin={() => undefined}
					onSessionTabRestore={() => undefined}
					onSessionTabsReorder={() => undefined}
					sessions={[previewSession]}
					unreadKeys={new Set()}
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
				workspaceId='workspace-1'
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

	test('renders an .ico as an image preview', () => {
		const iconPath = 'assets/favicon.ico';
		const client = createTestQueryClient();
		client.setQueryData(ensemblrQueryKeys.filePreview(workspaceCwd, iconPath), {
			content: previewImageContent,
			contentEncoding: 'base64',
			mimeType: 'image/x-icon',
			path: iconPath,
			sizeBytes: 8,
		});

		renderWithProviders(
			<FilePreviewPanel
				filePath={iconPath}
				workspaceCwd={workspaceCwd}
				workspaceId='workspace-1'
			/>,
			{ client },
		);

		expect(
			screen
				.getByRole('img', { name: `Preview of ${iconPath}` })
				.getAttribute('src'),
		).toBe(`data:image/x-icon;base64,${previewImageContent}`);
	});

	test('marks a file outside the workspace so its basename cannot mislead', () => {
		const outsidePath = '/tmp/scratch.md';
		const client = createTestQueryClient();
		client.setQueryData(
			ensemblrQueryKeys.filePreview(workspaceCwd, outsidePath),
			{
				content: '# scratch\n',
				contentEncoding: 'utf8',
				isExternal: true,
				path: outsidePath,
				sizeBytes: 10,
			},
		);

		renderWithProviders(
			<FilePreviewPanel
				filePath={outsidePath}
				workspaceCwd={workspaceCwd}
				workspaceId='workspace-1'
			/>,
			{ client },
		);

		expect(screen.queryByText('Outside workspace')).toBeTruthy();
	});

	test('leaves a workspace file unmarked', () => {
		const client = createTestQueryClient();
		client.setQueryData(
			ensemblrQueryKeys.filePreview(workspaceCwd, previewFilePath),
			{
				content: 'const x = 1;\n',
				contentEncoding: 'utf8',
				isExternal: false,
				path: previewFilePath,
				sizeBytes: 13,
			},
		);

		renderWithProviders(
			<FilePreviewPanel
				filePath={previewFilePath}
				workspaceCwd={workspaceCwd}
				workspaceId='workspace-1'
			/>,
			{ client },
		);

		expect(screen.queryByText('Outside workspace')).toBeNull();
	});

	test.each([
		['not-found', 'src/gone.ts', 'src/gone.ts does not exist.'],
		['not-file', 'src/lib', 'src/lib is a directory and cannot be previewed.'],
		['too-large', 'dump.log', 'dump.log is too large to preview.'],
		[
			'invalid-path',
			'bad::path',
			'bad::path is not a path this preview can open.',
		],
		['read-failed', 'locked.ts', 'Could not read locked.ts.'],
	])('explains a %s failure in the rendered message', (code, path, message) => {
		const client = createTestQueryClient();
		client.setQueryData(ensemblrQueryKeys.filePreview(workspaceCwd, path), {
			error: { code, message: 'main-process detail' },
			path,
		});

		renderWithProviders(
			<FilePreviewPanel
				filePath={path}
				workspaceCwd={workspaceCwd}
				workspaceId='workspace-1'
			/>,
			{ client },
		);

		expect(screen.getByText(message)).toBeTruthy();
	});

	test('hands the open-in menu the resolved path, not the tilde form the tab carries', () => {
		const tabPath = '~/.claude/plans/plan.md';
		const resolvedPath = '/Users/dev/.claude/plans/plan.md';
		const openWorkspaceInTarget = vi.fn(async () => ({ ok: true as const }));
		installEnsemblrApi({
			getAppSettings: async () => DEFAULT_APP_SETTINGS,
			openWorkspaceInTarget,
			updateAppSettings: async () => DEFAULT_APP_SETTINGS,
		});

		const client = createTestQueryClient();
		client.setQueryData(ensemblrQueryKeys.workspaceOpenTargets(), {
			targets: [
				{
					behavior: 'launch-app',
					iconName: 'vscode-icons:file-type-vscode',
					id: 'vscode',
					installed: true,
					isPrimary: true,
					kind: 'editor',
					label: 'VS Code',
					numberShortcutLabel: '1',
				},
			],
		});
		client.setQueryData(ensemblrQueryKeys.filePreview(workspaceCwd, tabPath), {
			content: '# plan\n',
			contentEncoding: 'utf8',
			isExternal: true,
			path: resolvedPath,
			sizeBytes: 7,
		});

		renderWithProviders(
			<FilePreviewPanel
				filePath={tabPath}
				workspaceCwd={workspaceCwd}
				workspaceId='workspace-1'
			/>,
			{ client },
		);

		fireEvent.keyDown(screen.getByRole('button', { name: 'Open in' }), {
			key: 'ArrowDown',
		});
		fireEvent.click(screen.getByRole('menuitem', { name: /VS Code/ }));

		expect(openWorkspaceInTarget).toHaveBeenCalledWith({
			relativePath: resolvedPath,
			relativePathKind: 'file',
			targetId: 'vscode',
			workspaceId: 'workspace-1',
		});
	});

	test('explains an invalid-cwd failure without naming a path', () => {
		const client = createTestQueryClient();
		client.setQueryData(
			ensemblrQueryKeys.filePreview(workspaceCwd, previewFilePath),
			{
				error: { code: 'invalid-cwd', message: 'main-process detail' },
				path: previewFilePath,
			},
		);

		renderWithProviders(
			<FilePreviewPanel
				filePath={previewFilePath}
				workspaceCwd={workspaceCwd}
				workspaceId='workspace-1'
			/>,
			{ client },
		);

		expect(
			screen.getByText('The workspace directory is unavailable.'),
		).toBeTruthy();
	});
});

const chatA: SessionTabModel = {
	chatTabId: 'chat-a',
	id: 'chat-a',
	isPreview: false,
	isSubAgent: false,
	kind: 'chat',
	label: 'Chat A',
	agentSessionId: null,
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
				onLaunchHarness={async () => null}
				onOpenArchitectureDiagram={async () => null}
				onSessionTabChange={() => undefined}
				onSessionTabClose={onSessionTabClose}
				onSessionTabOpen={async () => null}
				onSessionTabPin={() => undefined}
				onSessionTabRestore={() => undefined}
				onSessionTabsReorder={() => undefined}
				sessions={[chatA, chatB]}
				unreadKeys={new Set()}
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
				onLaunchHarness={async () => null}
				onOpenArchitectureDiagram={async () => null}
				onSessionTabChange={() => undefined}
				onSessionTabClose={() => undefined}
				onSessionTabOpen={async () => null}
				onSessionTabPin={() => undefined}
				onSessionTabRestore={() => undefined}
				onSessionTabsReorder={() => undefined}
				sessions={[chatA]}
				unreadKeys={new Set()}
			/>,
		);

		expect(screen.queryByRole('button', { name: /Close .* tab/ })).toBeNull();
	});

	test('keeps the close control for a lone non-chat tab', () => {
		renderWithProviders(
			<SessionTabs
				activeSession={previewSession}
				closedSessions={[]}
				onLaunchHarness={async () => null}
				onOpenArchitectureDiagram={async () => null}
				onSessionTabChange={() => undefined}
				onSessionTabClose={() => undefined}
				onSessionTabOpen={async () => null}
				onSessionTabPin={() => undefined}
				onSessionTabRestore={() => undefined}
				onSessionTabsReorder={() => undefined}
				sessions={[previewSession]}
				unreadKeys={new Set()}
			/>,
		);

		expect(
			screen.getByRole('button', { name: `Close ${previewSession.label} tab` }),
		).toBeTruthy();
	});
});
