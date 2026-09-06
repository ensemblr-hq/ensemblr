// @vitest-environment happy-dom

import { act } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import { type ReactElement, type ReactNode, useEffect, useState } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { ReviewPanel } from '@/renderer/components/workbench-shell/review-panel';
import { getDefaultWorkspace } from '@/renderer/fixtures/workbench';
import { useReviewPanelCommands } from '@/renderer/hooks/workbench-shell/use-review-panel-commands';
import { useMenuCommandBridge } from '@/renderer/state/menu-commands';
import { changesSourceByWorkspaceAtom } from '@/renderer/state/workspace';
import type { MenuCommandBroadcast, MenuContext } from '@/shared/menu-commands';

import {
	clearEnsemblrApi,
	installEnsemblrApi,
	installLocalStorage,
	renderWithProviders,
} from './support/dom';

const WORKSPACE = getDefaultWorkspace();

let listeners: Array<(payload: MenuCommandBroadcast) => void> = [];
let reported: MenuContext[] = [];

/** Dispatches a native-menu command through every subscribed bridge. */
function emit(command: MenuCommandBroadcast['command']): void {
	act(() => {
		for (const listener of listeners) {
			listener({ command });
		}
	});
}

/** The commands the bridge last told the menu to keep enabled. */
function enabledCommands(): readonly string[] {
	act(() => {
		vi.advanceTimersByTime(200);
	});
	return reported.at(-1)?.commands ?? [];
}

/**
 * Whether the keymap resolves `mod` onto ⌘ here, mirroring its own platform
 * check so a chord this test presses matches the binding on macOS and Linux
 * alike.
 */
function usesMetaForMod(): boolean {
	if (navigator.platform) {
		return /Mac|Darwin/i.test(navigator.platform);
	}
	return process.platform === 'darwin';
}

/** Presses a chord on the window, the way `useHotkey` listens for one. */
function press(key: string, options: { alt?: boolean } = {}): void {
	const usesMeta = usesMetaForMod();

	act(() => {
		window.dispatchEvent(
			new KeyboardEvent('keydown', {
				altKey: options.alt ?? false,
				ctrlKey: !usesMeta,
				key,
				metaKey: usesMeta,
			}),
		);
	});
}

/**
 * Mirrors how the workspace shell wires these commands: registered from a host
 * that stays mounted, with the review panel beside it under a switch the test
 * flips to stand in for a dismissed narrow-window rail sheet.
 */
function renderShell() {
	const onTabChange = vi.fn();
	const openFileSearch = vi.fn();
	const revealRail = vi.fn();
	const store = createStore();
	let hidePanel: () => void = () => undefined;

	function Host() {
		const [isPanelMounted, setIsPanelMounted] = useState(true);

		useMenuCommandBridge();
		useReviewPanelCommands({
			activeTab: 'files',
			onTabChange,
			openFileSearch,
			revealRail,
			workspaceId: WORKSPACE.id,
		});
		useEffect(() => {
			hidePanel = () => setIsPanelMounted(false);
		});

		return isPanelMounted ? <Panel /> : null;
	}

	renderWithProviders(withStore(store, <Host />));

	return {
		hidePanel: () => act(() => hidePanel()),
		onTabChange,
		openFileSearch,
		revealRail,
		store,
	};
}

/** The real review panel, with the props it needs to render the fixture. */
function Panel() {
	return (
		<ReviewPanel
			activeTab='files'
			onFileSearchOpen={() => undefined}
			onTabChange={() => undefined}
			workspace={WORKSPACE}
		/>
	);
}

/** Wraps a tree in one Jotai store the test can read atoms back from. */
function withStore(
	store: ReturnType<typeof createStore>,
	children: ReactNode,
): ReactElement {
	return <Provider store={store}>{children}</Provider>;
}

beforeEach(() => {
	vi.useFakeTimers();
	listeners = [];
	reported = [];
	installLocalStorage();
	installEnsemblrApi({
		onMenuCommand: (listener: (payload: MenuCommandBroadcast) => void) => {
			listeners = [...listeners, listener];
			return () => {
				listeners = listeners.filter((candidate) => candidate !== listener);
			};
		},
		reportMenuContext: (context: MenuContext) => {
			reported = [...reported, context];
			return Promise.resolve();
		},
	});
});

afterEach(() => {
	vi.useRealTimers();
	clearEnsemblrApi();
});

// Below the rail's breakpoint the review panel is hosted by a sheet that
// unmounts when dismissed. Both chords are owned by their menu item on macOS, so
// a registration that died with the panel would not fall through to the
// renderer — AppKit would swallow the keystroke against a disabled item.
test('the ⌘P palette survives the review panel unmounting', () => {
	const { hidePanel, openFileSearch } = renderShell();

	hidePanel();

	expect(enabledCommands()).toContain('files.search');
	emit('files.search');
	expect(openFileSearch).toHaveBeenCalledTimes(1);
	press('p');
	expect(openFileSearch).toHaveBeenCalledTimes(2);
});

test('⌥⌘U survives the review panel unmounting', () => {
	const { hidePanel, onTabChange, store } = renderShell();

	hidePanel();

	expect(enabledCommands()).toContain('changes.uncommitted');
	press('u', { alt: true });

	expect(onTabChange).toHaveBeenCalledWith('changes');
	expect(store.get(changesSourceByWorkspaceAtom)[WORKSPACE.id]).toEqual({
		kind: 'uncommitted',
	});
});

// Selecting the uncommitted set behind a collapsed rail would show nothing.
test('⌥⌘U reveals the rail as well as selecting the tab', () => {
	const { revealRail } = renderShell();

	press('u', { alt: true });

	expect(revealRail).toHaveBeenCalledTimes(1);
});

// The palette is a modal over the whole window, so it needs no rail behind it.
test('the ⌘P palette does not reveal the rail', () => {
	const { revealRail } = renderShell();

	press('p');

	expect(revealRail).not.toHaveBeenCalled();
});

// Discard stays behind the panel on purpose: it carries no accelerator, and
// discarding the change list from a menu while the list is closed is not a
// coherent action — so it doubles as this test's positive control.
test('the review panel keeps only Discard changes, not the two moved commands', () => {
	renderWithProviders(
		withStore(
			createStore(),
			<BridgeOnly>
				<Panel />
			</BridgeOnly>,
		),
	);

	const commands = enabledCommands();

	expect(commands).toContain('review.discardChanges');
	expect(commands).not.toContain('files.search');
	expect(commands).not.toContain('changes.uncommitted');
});

/** Hosts the bridge without the shell's registrations, to isolate the panel. */
function BridgeOnly({ children }: { children: ReactNode }) {
	useMenuCommandBridge();
	return children;
}
