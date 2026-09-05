// @vitest-environment happy-dom

import { fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test } from 'vitest';

import { SessionTabs } from '../../src/renderer/components/workbench-shell/conversation-panel/session-tabs';
import type { SessionTabModel } from '../../src/renderer/types/workbench';
import { matchesShortcut } from '../../src/shared/keymap';
import {
	clearEnsemblrApi,
	installEnsemblrApi,
	installLocalStorage,
	renderWithProviders,
} from './support/dom';

/** Builds a chat strip tab whose label doubles as its id. */
function createChatTab(id: string): SessionTabModel {
	return {
		chatTabId: id,
		fullLabel: id,
		id,
		isPreview: false,
		isSubAgent: false,
		kind: 'chat',
		label: id,
		agentSessionId: null,
		status: 'idle',
		summary: '',
		updatedLabel: '',
	};
}

/** Builds a file strip tab, ephemeral unless the caller says otherwise. */
function createFileTab(id: string, isPreview: boolean): SessionTabModel {
	return {
		chatTabId: id,
		filePath: `src/${id}.ts`,
		fullLabel: id,
		id,
		isPreview,
		isSubAgent: false,
		kind: 'file',
		label: id,
		agentSessionId: null,
		status: 'idle',
		summary: '',
		updatedLabel: '',
	};
}

/**
 * Renders the strip with a chat tab plus one file tab, capturing pin requests.
 * @param isPreview - Whether the file tab holds the preview slot
 * @returns The render result and the ids the strip asked to pin
 */
function renderStrip(isPreview: boolean) {
	const pinned: string[] = [];
	const sessions = [createChatTab('chat'), createFileTab('preview', isPreview)];
	const rendered = renderWithProviders(
		<SessionTabs
			activeSession={sessions[1]}
			closedSessions={[]}
			onLaunchHarness={() => Promise.resolve(null)}
			onOpenArchitectureDiagram={async () => null}
			onSessionTabChange={() => undefined}
			onSessionTabClose={() => undefined}
			onSessionTabOpen={() => Promise.resolve(null)}
			onSessionTabPin={(sessionId) => pinned.push(sessionId)}
			onSessionTabRestore={() => undefined}
			onSessionTabsReorder={() => undefined}
			sessions={sessions}
			unreadKeys={new Set()}
		/>,
	);
	return { pinned, ...rendered };
}

beforeEach(() => {
	installLocalStorage();
	installEnsemblrApi({
		listAgentHarnesses: () => Promise.resolve({ harnesses: [] }),
	});
});

afterEach(() => {
	clearEnsemblrApi();
});

test('renders a preview tab label in italics', () => {
	const { getByText } = renderStrip(true);

	expect(getByText('preview')).toHaveClass('italic');
});

test('renders a pinned tab label upright', () => {
	const { getByText } = renderStrip(false);

	expect(getByText('preview')).not.toHaveClass('italic');
});

test('double-clicking a tab asks to pin it', async () => {
	const { getByText, pinned } = renderStrip(true);

	await userEvent.dblClick(getByText('preview'));

	expect(pinned).toEqual(['preview']);
});

/**
 * Keydown init for `tab.keepOpen`, resolved through the app's own matcher so the
 * test presses ⌘ or Ctrl depending on the platform the runner reports.
 */
function keepOpenKeydown() {
	const candidates = [
		{
			altKey: false,
			code: 'KeyO',
			ctrlKey: false,
			key: 'O',
			metaKey: true,
			shiftKey: true,
		},
		{
			altKey: false,
			code: 'KeyO',
			ctrlKey: true,
			key: 'O',
			metaKey: false,
			shiftKey: true,
		},
	];
	const match = candidates.find((candidate) =>
		matchesShortcut('tab.keepOpen', candidate),
	);
	if (!match) {
		throw new Error('No candidate keydown matches tab.keepOpen');
	}
	return match;
}

test('the keep-open shortcut pins the active tab', () => {
	const { pinned } = renderStrip(true);

	fireEvent.keyDown(window, keepOpenKeydown());

	expect(pinned).toEqual(['preview']);
});
