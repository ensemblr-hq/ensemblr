import { afterEach, expect, test } from 'vitest';
import { i18n } from '../../src/renderer/lib/i18n';
import {
	toClosedSessionTabModel,
	toSessionTabModel,
} from '../../src/renderer/state/workspace/session-tab-model-mappers';
import type {
	ChatTabSummaryEntryWire,
	ChatTabWire,
} from '../../src/shared/ipc/contracts/chat-tab';

/**
 * Builds a chat tab wire row the main process stored without a title.
 * @returns An untitled chat `ChatTabWire`.
 */
function untitledTab(): ChatTabWire {
	return {
		closedAt: null,
		fullTitle: '',
		id: 'tab-1',
		isPreview: false,
		kind: 'chat',
		metadata: {},
		openedAt: '2026-07-20T10:00:00.000Z',
		agentSessionId: null,
		position: 0,
		title: '',
		workspaceId: 'ws-1',
	};
}

/**
 * Wraps an untitled tab as a closed-tab history entry with no summary title.
 * @returns A closed entry whose only label source is the placeholder.
 */
function untitledClosedEntry(): ChatTabSummaryEntryWire {
	return {
		closedAt: '2026-07-20T11:00:00.000Z',
		summaryPath: '/tmp/summary.md',
		summaryTitle: '',
		summaryUpdatedAt: '2026-07-20T11:00:00.000Z',
		tab: { ...untitledTab(), closedAt: '2026-07-20T11:00:00.000Z' },
	};
}

afterEach(async () => {
	await i18n.changeLanguage('en');
});

test('an untitled open tab is labelled in the active language', async () => {
	await i18n.changeLanguage('en');
	expect(toSessionTabModel(untitledTab(), undefined).label).toBe('New chat');

	await i18n.changeLanguage('ru');
	expect(toSessionTabModel(untitledTab(), undefined).label).toBe('Новый чат');

	await i18n.changeLanguage('el');
	expect(toSessionTabModel(untitledTab(), undefined).label).toBe(
		'Νέα συνομιλία',
	);
});

test('an untitled open tab localizes its tooltip label too', async () => {
	await i18n.changeLanguage('ru');
	expect(toSessionTabModel(untitledTab(), undefined).fullLabel).toBe(
		'Новый чат',
	);
});

test('an untitled closed tab reads as untitled, not as new', async () => {
	await i18n.changeLanguage('en');
	expect(toClosedSessionTabModel(untitledClosedEntry()).label).toBe(
		'Untitled chat',
	);

	await i18n.changeLanguage('ru');
	expect(toClosedSessionTabModel(untitledClosedEntry()).label).toBe(
		'Диалог без названия',
	);
});

test('an untitled file tab is named after the file it opens', async () => {
	await i18n.changeLanguage('ru');
	const fileTab: ChatTabWire = {
		...untitledTab(),
		kind: 'file',
		metadata: { filePath: 'src/renderer/components/message.tsx' },
	};
	const model = toSessionTabModel(fileTab, undefined);
	expect(model.label).toBe('message.tsx');
	expect(model.fullLabel).toBe('message.tsx');
});

test('an untitled diff tab is named after the file it diffs', async () => {
	const diffTab: ChatTabWire = {
		...untitledTab(),
		kind: 'diff',
		metadata: { filePath: 'src/main/main.ts' },
	};
	expect(toSessionTabModel(diffTab, undefined).label).toBe('main.ts');
});

test('an untitled non-chat tab with no path reads as untitled, not as new', async () => {
	const documentTab: ChatTabWire = { ...untitledTab(), kind: 'document' };

	await i18n.changeLanguage('en');
	expect(toSessionTabModel(documentTab, undefined).label).toBe('Untitled');

	await i18n.changeLanguage('ru');
	expect(toSessionTabModel(documentTab, undefined).label).toBe('Без названия');
});

test('a titled tab keeps its own title', async () => {
	await i18n.changeLanguage('ru');
	const titled: ChatTabWire = { ...untitledTab(), title: 'Fix the parser' };
	expect(toSessionTabModel(titled, undefined).label).toBe('Fix the parser');
});
