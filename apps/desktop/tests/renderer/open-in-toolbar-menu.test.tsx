// @vitest-environment happy-dom

import { fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

vi.mock('@iconify/react', () => ({
	addCollection: () => undefined,
	Icon: ({ icon }: { icon: string }) => <span data-icon={icon} />,
}));

import { ensemblrQueryKeys } from '../../src/renderer/api/ensemblr-queries';
import { OpenInToolbarMenu } from '../../src/renderer/components/workbench-shell/open-in-toolbar-menu';
import type { WorkspaceOpenTarget } from '../../src/renderer/types/workbench';
import {
	clearEnsemblrApi,
	createTestQueryClient,
	installEnsemblrApi,
	installLocalStorage,
	renderWithProviders,
} from './support/dom';

const FILE_PATH = 'src/renderer/lib/workbench/review-files.ts';
const WORKSPACE_ID = 'workspace-1';

const EDITOR: WorkspaceOpenTarget = {
	behavior: 'launch-app',
	iconName: 'vscode-icons:file-type-vscode',
	id: 'vscode',
	installed: true,
	isPrimary: true,
	kind: 'editor',
	label: 'VS Code',
	numberShortcutLabel: '1',
};

const COPY: WorkspaceOpenTarget = {
	behavior: 'copy-path',
	iconName: 'lucide:copy',
	id: 'copy-path',
	installed: true,
	kind: 'utility',
	label: 'Copy path',
	numberShortcutLabel: '2',
};

function renderMenu(targets: WorkspaceOpenTarget[]) {
	const openWorkspaceInTarget = vi.fn(async () => ({ ok: true as const }));
	installEnsemblrApi({ openWorkspaceInTarget });

	const client = createTestQueryClient();
	client.setQueryData(ensemblrQueryKeys.workspaceOpenTargets(), {
		targets,
	});

	const rendered = renderWithProviders(
		<OpenInToolbarMenu filePath={FILE_PATH} workspaceId={WORKSPACE_ID} />,
		{ client },
	);

	return { ...rendered, openWorkspaceInTarget };
}

beforeEach(() => {
	installLocalStorage();
});

afterEach(() => {
	clearEnsemblrApi();
});

test('renders nothing until app detection returns a target', () => {
	installEnsemblrApi({ openWorkspaceInTarget: vi.fn() });
	const { container } = renderWithProviders(
		<OpenInToolbarMenu filePath={FILE_PATH} workspaceId={WORKSPACE_ID} />,
	);

	expect(container.querySelector('button')).toBeNull();
});

test('names the toolbar trigger by its visible label', () => {
	const { getByRole } = renderMenu([EDITOR, COPY]);

	const trigger = getByRole('button', { name: 'Open in' });
	expect(trigger.className).toContain('h-6');
	expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
});

test('opens the chosen app on the file rather than the workspace root', async () => {
	const { getByRole, openWorkspaceInTarget } = renderMenu([EDITOR, COPY]);

	fireEvent.keyDown(getByRole('button', { name: 'Open in' }), {
		key: 'ArrowDown',
	});
	fireEvent.click(getByRole('menuitem', { name: /VS Code/ }));

	expect(openWorkspaceInTarget).toHaveBeenCalledWith({
		relativePath: FILE_PATH,
		relativePathKind: 'file',
		targetId: 'vscode',
		workspaceId: WORKSPACE_ID,
	});
});

test('offers the copy-path utility below the detected apps', () => {
	const { getByRole, openWorkspaceInTarget } = renderMenu([EDITOR, COPY]);

	fireEvent.keyDown(getByRole('button', { name: 'Open in' }), {
		key: 'ArrowDown',
	});
	fireEvent.click(getByRole('menuitem', { name: /Copy path/ }));

	expect(openWorkspaceInTarget).toHaveBeenCalledWith({
		relativePath: FILE_PATH,
		relativePathKind: 'file',
		targetId: 'copy-path',
		workspaceId: WORKSPACE_ID,
	});
});
