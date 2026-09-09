// @vitest-environment happy-dom

import { fireEvent, screen } from '@testing-library/react';
import type { DynamicToolUIPart } from 'ai';
import { describe, expect, test, vi } from 'vitest';

vi.mock('@iconify/react', () => ({
	addCollection: () => undefined,
	Icon: ({ icon }: { icon: string }) => <span data-icon={icon} />,
}));

import { ChatToolCall } from '../../src/renderer/components/chat-tool-call';
import { ChatUserPrompt } from '../../src/renderer/components/chat-user-prompt';
import {
	FilePreviewOpenerProvider,
	WorkspacePathResolverProvider,
} from '../../src/renderer/components/workbench-shell/conversation-panel/file-preview-context';
import { createWorkspacePathResolver } from '../../src/renderer/lib/agent-timeline';
import { renderWithProviders } from './support/dom';

function readDirectoryPart(path: string): DynamicToolUIPart {
	return {
		input: { path },
		state: 'input-available',
		toolCallId: `read-${path}`,
		toolName: 'read',
		type: 'dynamic-tool',
	};
}

function editFilePart(path: string): DynamicToolUIPart {
	return {
		input: { path },
		state: 'input-available',
		toolCallId: `edit-${path}`,
		toolName: 'edit',
		type: 'dynamic-tool',
	};
}

function symbolSearchPart(path: string): DynamicToolUIPart {
	return {
		input: { paths: [path], query: 'presenter' },
		state: 'input-available',
		toolCallId: `symbol-search-${path}`,
		toolName: 'symbol_search',
		type: 'dynamic-tool',
	};
}

function listDirectoryPart(path: string): DynamicToolUIPart {
	return {
		input: { path },
		state: 'input-available',
		toolCallId: `list-directory-${path}`,
		toolName: 'list_directory',
		type: 'dynamic-tool',
	};
}

describe('directory attachment chips', () => {
	test('renders read tool chips for known directories with a folder icon', () => {
		const openPreview = vi.fn();
		const { container } = renderWithProviders(
			<WorkspacePathResolverProvider
				value={(path) => ({
					kind: path === 'src/renderer' ? 'directory' : 'file',
					path,
					scope: 'workspace',
				})}
			>
				<FilePreviewOpenerProvider value={openPreview}>
					<ChatToolCall part={readDirectoryPart('src/renderer')} />
				</FilePreviewOpenerProvider>
			</WorkspacePathResolverProvider>,
		);

		expect(container.innerHTML).toContain('default-folder');
		fireEvent.click(screen.getByRole('button', { name: 'renderer' }));
		expect(openPreview).toHaveBeenCalledWith('src/renderer');
	});

	test('uses the resolved folder kind for a directory-scoped symbol search', () => {
		const { container } = renderWithProviders(
			<WorkspacePathResolverProvider
				value={(path) => ({
					kind: path === 'src/renderer' ? 'directory' : 'file',
					path,
					scope: 'workspace',
				})}
			>
				<ChatToolCall part={symbolSearchPart('src/renderer')} />
			</WorkspacePathResolverProvider>,
		);

		expect(container.innerHTML).toContain('default-folder');
	});

	test.each([
		{ condition: 'startup before the file tree loads', workspaceCwd: '/repo' },
		{ condition: 'a non-git workspace', workspaceCwd: null },
	])('preserves a known folder during $condition', ({ workspaceCwd }) => {
		const resolver = createWorkspacePathResolver([], workspaceCwd);
		const { container } = renderWithProviders(
			<WorkspacePathResolverProvider value={resolver}>
				<ChatToolCall part={listDirectoryPart('src/renderer')} />
			</WorkspacePathResolverProvider>,
		);

		expect(resolver('src/renderer')).toMatchObject({ kind: 'file' });
		expect(container.innerHTML).toContain('default-folder');
	});

	test('omits redundant edit path when a file chip is present', () => {
		renderWithProviders(
			<ChatToolCall part={editFilePart('src/app/page.tsx')} />,
		);

		expect(screen.getByText('Edit')).toBeTruthy();
		expect(screen.getByText('page.tsx')).toBeTruthy();
		expect(screen.queryByText('src/app/page.tsx')).toBeNull();
	});

	test('activates referenced folder prompt chips', () => {
		const openPreview = vi.fn();
		renderWithProviders(
			<FilePreviewOpenerProvider value={openPreview}>
				<ChatUserPrompt
					prompt={'Referenced workspace folders:\n@src/renderer\n\nInspect it'}
				/>
			</FilePreviewOpenerProvider>,
		);

		fireEvent.click(screen.getByRole('button', { name: 'renderer' }));
		expect(openPreview).toHaveBeenCalledWith('src/renderer');
	});

	// The surface that provides a resolver has the last word: a file attached and
	// since deleted would otherwise offer a control that opens onto a read error.
	test('leaves a prompt chip inert when the resolver cannot place its path', () => {
		const openPreview = vi.fn();
		renderWithProviders(
			<WorkspacePathResolverProvider value={() => null}>
				<FilePreviewOpenerProvider value={openPreview}>
					<ChatUserPrompt
						prompt={'Referenced workspace files:\n@notes.md\n\nRead it'}
					/>
				</FilePreviewOpenerProvider>
			</WorkspacePathResolverProvider>,
		);

		expect(screen.queryByRole('button', { name: 'notes.md' })).toBeNull();
		expect(openPreview).not.toHaveBeenCalled();
	});
});
