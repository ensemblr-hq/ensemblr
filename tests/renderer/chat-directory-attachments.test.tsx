// @vitest-environment happy-dom

import { fireEvent, screen } from '@testing-library/react';
import type { DynamicToolUIPart } from 'ai';
import { describe, expect, test, vi } from 'vitest';

vi.mock('@iconify/react', () => ({
	addCollection: () => undefined,
	Icon: ({ icon }: { icon: string }) => <span data-icon={icon} />,
}));

import { ChatToolRow } from '../../src/renderer/components/chat-activity-row';
import { ChatUserPrompt } from '../../src/renderer/components/chat-user-prompt';
import {
	FilePreviewOpenerProvider,
	WorkspacePathKindResolverProvider,
} from '../../src/renderer/components/workbench-shell/conversation-panel/file-preview-context';
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

describe('directory attachment chips', () => {
	test('renders read tool chips for known directories with a folder icon', () => {
		const openPreview = vi.fn();
		const { container } = renderWithProviders(
			<WorkspacePathKindResolverProvider
				value={(path) => (path === 'src/renderer' ? 'directory' : 'file')}
			>
				<FilePreviewOpenerProvider value={openPreview}>
					<ChatToolRow part={readDirectoryPart('src/renderer')} />
				</FilePreviewOpenerProvider>
			</WorkspacePathKindResolverProvider>,
		);

		expect(container.innerHTML).toContain('default-folder');
		fireEvent.click(screen.getByRole('button', { name: 'renderer' }));
		expect(openPreview).toHaveBeenCalledWith('src/renderer');
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
});
