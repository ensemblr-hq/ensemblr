import { createStore, Provider } from 'jotai';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';

import { ChatMessageText } from '../../src/renderer/components/chat-message-text';
import {
	FilePreviewOpenerProvider,
	WorkspacePathResolverProvider,
} from '../../src/renderer/components/workbench-shell/conversation-panel/file-preview-context';
import { createWorkspacePathResolver } from '../../src/renderer/lib/pi';
import { appSettingsAtom } from '../../src/renderer/state/preferences';
import type { WorkspaceFileSummary } from '../../src/renderer/types/workbench';
import { DEFAULT_APP_SETTINGS } from '../../src/shared/config';

function renderWithMarkdownStyle(
	markdownStyle: 'default' | 'compact' | 'prose',
	children: ReactNode,
): string {
	const store = createStore();
	store.set(appSettingsAtom, {
		...DEFAULT_APP_SETTINGS,
		appearance: { ...DEFAULT_APP_SETTINGS.appearance, markdownStyle },
	});
	return renderToStaticMarkup(<Provider store={store}>{children}</Provider>);
}

describe('answer typography', () => {
	test('marks the answer surface so the typography sheet applies', () => {
		const markup = renderWithMarkdownStyle(
			'default',
			<ChatMessageText text={'## Heading\n\nBody copy.'} />,
		);

		expect(markup).toContain('ensemblr-answer');
		expect(markup).not.toContain('ensemblr-answer-default');
	});

	test.each([
		['compact', 'ensemblr-answer-compact'],
		['prose', 'ensemblr-answer-prose'],
	] as const)('carries the %s density modifier', (markdownStyle, expected) => {
		const markup = renderWithMarkdownStyle(
			markdownStyle,
			<ChatMessageText text='Body copy.' />,
		);

		expect(markup).toContain(expected);
	});

	test('renders path chips on the inline prose scale', () => {
		const markup = renderWithMarkdownStyle(
			'default',
			<ChatMessageText text='Edit `src/renderer/components/message.tsx` next.' />,
		);

		expect(markup).toContain('ensemblr-answer-chip');
	});
});

const TABLE_MARKDOWN = [
	'| Step | Command | Expect |',
	'| --- | --- | --- |',
	'| Types | `npm run typecheck` | clean |',
	'| Build | `npm run build` | dist/server/entry.mjs |',
].join('\n');

describe('answer tables', () => {
	test('renders the table body on the answer surface', () => {
		const markup = renderWithMarkdownStyle(
			'default',
			<ChatMessageText text={TABLE_MARKDOWN} />,
		);

		expect(markup).toContain('data-streamdown="table"');
		expect(markup).toContain('<th');
		expect(markup).toContain('<td');
		expect(markup).not.toContain('data-streamdown="table-wrapper"');
	});

	test('keeps the copy and expand controls but drops download', () => {
		const markup = renderWithMarkdownStyle(
			'default',
			<ChatMessageText text={TABLE_MARKDOWN} />,
		);

		expect(markup).toContain('aria-label="Copy table"');
		expect(markup).toContain('aria-label="Expand table"');
		expect(markup).not.toContain('Download table');
	});
});

const WORKSPACE_FILES: readonly WorkspaceFileSummary[] = [
	'src/renderer/components/message.tsx',
	'src/renderer/components/code-surface.tsx',
	'src/main/components/message.tsx',
].map((path) => ({
	id: path,
	kind: 'file' as const,
	name: path.split('/').at(-1) ?? path,
	path,
}));

/**
 * Renders an answer inside a workspace conversation, so chips see both the
 * file-preview opener and the path resolver the real timeline provides.
 */
function renderInWorkspace(text: string): string {
	const store = createStore();
	store.set(appSettingsAtom, DEFAULT_APP_SETTINGS);
	return renderToStaticMarkup(
		<Provider store={store}>
			<WorkspacePathResolverProvider
				value={createWorkspacePathResolver(WORKSPACE_FILES, '/repo')}
			>
				<FilePreviewOpenerProvider value={() => undefined}>
					<ChatMessageText text={text} />
				</FilePreviewOpenerProvider>
			</WorkspacePathResolverProvider>
		</Provider>,
	);
}

describe('answer path chips', () => {
	test('opens a path the workspace holds', () => {
		const markup = renderInWorkspace(
			'See `src/renderer/components/message.tsx`.',
		);

		expect(markup).toContain('<button');
		expect(markup).not.toContain('ensemblr-answer-chip-missing');
	});

	test('opens a truncated path the workspace can place unambiguously', () => {
		const markup = renderInWorkspace('See `components/code-surface.tsx`.');

		expect(markup).toContain('<button');
		expect(markup).toContain(
			'title="src/renderer/components/code-surface.tsx"',
		);
	});

	test('leaves a path the workspace no longer holds as plain inline code', () => {
		const markup = renderInWorkspace('See `src/renderer/components/gone.tsx`.');

		expect(markup).toContain('<code>src/renderer/components/gone.tsx</code>');
		expect(markup).not.toContain('ensemblr-answer-chip');
		expect(markup).not.toContain('<button');
	});

	test('leaves an ambiguous truncated path as plain inline code', () => {
		const markup = renderInWorkspace('See `components/message.tsx`.');

		expect(markup).toContain('<code>components/message.tsx</code>');
		expect(markup).not.toContain('ensemblr-answer-chip');
	});
});
