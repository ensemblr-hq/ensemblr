// @vitest-environment happy-dom

import { fireEvent, screen } from '@testing-library/react';
import type { DynamicToolUIPart } from 'ai';
import { describe, expect, test, vi } from 'vitest';

vi.mock('@iconify/react', () => ({
	addCollection: () => undefined,
	Icon: ({ icon }: { icon: string }) => <span data-icon={icon} />,
}));

import { ChatToolCall } from '../../src/renderer/components/chat-tool-call';
import {
	FilePreviewOpenerProvider,
	WorkspacePathResolverProvider,
} from '../../src/renderer/components/workbench-shell/conversation-panel/file-preview-context';
import { createWorkspacePathResolver } from '../../src/renderer/lib/agent-timeline';
import type { WorkspaceFileSummary } from '../../src/renderer/types/workbench';
import { renderWithProviders } from './support/dom';

const WORKSPACE_CWD = '/repos/app';

const FILES: readonly WorkspaceFileSummary[] = [
	{ id: 'README.md', kind: 'file', name: 'README.md', path: 'README.md' },
];

function writePart(filePath: string): DynamicToolUIPart {
	return {
		input: { file_path: filePath },
		state: 'input-available',
		toolCallId: `write-${filePath}`,
		toolName: 'write',
		type: 'dynamic-tool',
	};
}

function renderToolCall(part: DynamicToolUIPart, openPreview: () => void) {
	return renderWithProviders(
		<WorkspacePathResolverProvider
			value={createWorkspacePathResolver(FILES, WORKSPACE_CWD)}
		>
			<FilePreviewOpenerProvider value={openPreview}>
				<ChatToolCall part={part} />
			</FilePreviewOpenerProvider>
		</WorkspacePathResolverProvider>,
	);
}

describe('tool badges for files outside the workspace', () => {
	test('opens a file an agent wrote to an absolute path outside the workspace', () => {
		const openPreview = vi.fn();
		renderToolCall(writePart('/tmp/scratch.md'), openPreview);

		fireEvent.click(screen.getByRole('button', { name: 'scratch.md' }));

		expect(openPreview).toHaveBeenCalledWith('/tmp/scratch.md');
	});

	test('opens a file under the home directory', () => {
		const openPreview = vi.fn();
		renderToolCall(writePart('~/.claude/plans/plan.md'), openPreview);

		fireEvent.click(screen.getByRole('button', { name: 'plan.md' }));

		expect(openPreview).toHaveBeenCalledWith('~/.claude/plans/plan.md');
	});

	test('opens a sibling worktree reached by climbing out of the workspace', () => {
		const openPreview = vi.fn();
		renderToolCall(writePart('../sibling/notes.md'), openPreview);

		fireEvent.click(screen.getByRole('button', { name: 'notes.md' }));

		expect(openPreview).toHaveBeenCalledWith('/repos/sibling/notes.md');
	});

	test('relativizes an absolute path that is inside the workspace', () => {
		const openPreview = vi.fn();
		renderToolCall(writePart(`${WORKSPACE_CWD}/README.md`), openPreview);

		fireEvent.click(screen.getByRole('button', { name: 'README.md' }));

		expect(openPreview).toHaveBeenCalledWith('README.md');
	});

	test('leaves a workspace path the tree no longer holds inert', () => {
		const openPreview = vi.fn();
		renderToolCall(writePart('src/deleted.ts'), openPreview);

		expect(screen.getByText('deleted.ts')).toBeTruthy();
		expect(screen.queryByRole('button', { name: 'deleted.ts' })).toBeNull();
		expect(openPreview).not.toHaveBeenCalled();
	});
});
