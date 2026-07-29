// @vitest-environment happy-dom

import { fireEvent, screen, within } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import type { ReactElement } from 'react';
import { describe, expect, test, vi } from 'vitest';

vi.mock('@iconify/react', () => ({
	addCollection: () => undefined,
	Icon: ({ icon }: { icon: string }) => <span data-icon={icon} />,
}));

vi.mock('../../src/renderer/lib/code/highlighter', () => ({
	highlightCode: () => null,
}));

import {
	ChatCustomMessage,
	ChatSkillInvocation,
} from '../../src/renderer/components/chat-tool-call';
import { ChatUserPrompt } from '../../src/renderer/components/chat-user-prompt';
import {
	FilePreviewOpenerProvider,
	WorkspacePathResolverProvider,
} from '../../src/renderer/components/workbench-shell/conversation-panel/file-preview-context';
import { renderWithProviders } from './support/dom';

const DOC_MARKER = '[Context7 Docs: tailwind (/rails/tailwindcss-rails)]';

const INJECTED_DOCS = [
	DOC_MARKER,
	'',
	'## tailwindcss:build',
	'',
	'Compiles Tailwind CSS from the source file into a minified output file.',
].join('\n');

function renderRow(ui: ReactElement) {
	const store = createStore();
	return renderWithProviders(
		<Provider store={store}>
			<WorkspacePathResolverProvider
				value={(filePath: string) => ({ kind: 'file', path: filePath })}
			>
				<FilePreviewOpenerProvider value={() => undefined}>
					{ui}
				</FilePreviewOpenerProvider>
			</WorkspacePathResolverProvider>
		</Provider>,
	);
}

function openRow(title: string): HTMLElement {
	const toggle = screen.getByRole('button', { name: title });
	fireEvent.click(toggle);
	const body = document.getElementById(
		toggle.getAttribute('aria-controls') ?? '',
	);
	if (body === null) {
		throw new Error(`Row "${title}" opened onto no body`);
	}
	return body;
}

describe('extension-injected context rows', () => {
	test('holds injected documentation behind a collapsed row', () => {
		renderRow(
			<ChatCustomMessage
				data={{
					customType: 'context7_docs',
					display: false,
					text: INJECTED_DOCS,
				}}
			/>,
		);

		expect(screen.queryByText(/Compiles Tailwind CSS/)).not.toBeInTheDocument();
		expect(screen.queryByText(DOC_MARKER, { exact: false })).toBeNull();

		const body = openRow('Context7 docs');

		expect(within(body).getByText(/Compiles Tailwind CSS/)).toBeInTheDocument();
	});
});

describe('skill invocation prompts', () => {
	test('renders the reconstructed command as a plain bubble', () => {
		renderRow(<ChatUserPrompt prompt='/skill:caveman summarize the diff' />);

		const bubble = document.querySelector('[data-role="user-prompt"]');
		expect(bubble).toHaveTextContent('/skill:caveman summarize the diff');
		expect(screen.queryByText(/Respond terse/)).toBeNull();
		expect(screen.queryByRole('button')).toBeNull();
	});

	test('renders a bare invocation carrying no arguments', () => {
		renderRow(<ChatUserPrompt prompt='/skill:caveman' />);

		expect(
			document.querySelector('[data-role="user-prompt"]'),
		).toHaveTextContent('/skill:caveman');
	});

	test('leaves an ordinary prompt as a plain bubble', () => {
		renderRow(<ChatUserPrompt prompt='Implement the attached plan.' />);

		expect(
			screen.getByText('Implement the attached plan.'),
		).toBeInTheDocument();
		expect(screen.queryByRole('button')).toBeNull();
	});
});

describe('skill activation rows', () => {
	test('names the skill and marks it activated inside the turn', () => {
		renderRow(<ChatSkillInvocation name='caveman' />);

		expect(screen.getByText('Caveman')).toBeInTheDocument();
		expect(screen.getByText('Skill activated')).toBeInTheDocument();
	});
});
