// @vitest-environment happy-dom

import { act } from '@testing-library/react';
import { Provider } from 'jotai';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import {
	useMenuCommand,
	useMenuCommandBridge,
	useMenuCommandChecked,
} from '@/renderer/state/menu-commands';
import type { MenuCommandBroadcast, MenuContext } from '@/shared/menu-commands';
import {
	clearEnsemblrApi,
	installEnsemblrApi,
	renderWithProviders,
} from './support/dom';

type MenuCommandListener = (payload: MenuCommandBroadcast) => void;

let listeners: MenuCommandListener[] = [];
let reported: MenuContext[] = [];
const closeWindow = vi.fn();

/** Dispatches a menu command through every subscribed provider. */
function emit(command: MenuCommandBroadcast['command'], arg?: string): void {
	act(() => {
		for (const listener of listeners) {
			listener({ arg, command });
		}
	});
}

/** Registers `handler` for `command` for as long as it is mounted. */
function Registrant({
	children,
	command,
	enabled,
	handler,
}: {
	children?: ReactNode;
	command: MenuCommandBroadcast['command'];
	enabled?: boolean;
	handler: (arg?: string) => void;
}) {
	useMenuCommand(command, handler, enabled);
	return children ?? null;
}

/** Marks `command` checked for as long as it is mounted. */
function CheckedClaimant({
	checked,
	command,
}: {
	checked: boolean;
	command: MenuCommandBroadcast['command'];
}) {
	useMenuCommandChecked(command, checked);
	return null;
}

/** Hosts the bridge under test, which is a hook rather than a provider. */
function Bridge({ children }: { children: ReactNode }) {
	useMenuCommandBridge();
	return children;
}

/** Wraps children in a fresh Jotai store plus the bridge under test. */
function harness(children: ReactNode) {
	return (
		<Provider>
			<Bridge>{children}</Bridge>
		</Provider>
	);
}

beforeEach(() => {
	vi.useFakeTimers();
	listeners = [];
	reported = [];
	closeWindow.mockClear();
	installEnsemblrApi({
		closeWindow,
		onMenuCommand: (listener: MenuCommandListener) => {
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

describe('useMenuCommandBridge', () => {
	test('dispatches a command to its registered handler', () => {
		const handler = vi.fn();
		renderWithProviders(
			harness(<Registrant command='workspace.new' handler={handler} />),
		);

		emit('workspace.new');

		expect(handler).toHaveBeenCalledTimes(1);
	});

	test('passes the dynamic submenu argument through', () => {
		const handler = vi.fn();
		renderWithProviders(
			harness(<Registrant command='run.script' handler={handler} />),
		);

		emit('run.script', 'dev');

		expect(handler).toHaveBeenCalledWith('dev');
	});

	test('the most recently registered handler wins', () => {
		const first = vi.fn();
		const second = vi.fn();
		renderWithProviders(
			harness(
				<>
					<Registrant command='tab.close' handler={first} />
					<Registrant command='tab.close' handler={second} />
				</>,
			),
		);

		emit('tab.close');

		expect(second).toHaveBeenCalledTimes(1);
		expect(first).not.toHaveBeenCalled();
	});

	test('unmounting the top handler restores the one beneath it', () => {
		const first = vi.fn();
		const second = vi.fn();
		const { rerender } = renderWithProviders(
			harness(
				<>
					<Registrant command='tab.close' handler={first} />
					<Registrant command='tab.close' handler={second} />
				</>,
			),
		);

		rerender(harness(<Registrant command='tab.close' handler={first} />));
		emit('tab.close');

		expect(first).toHaveBeenCalledTimes(1);
		expect(second).not.toHaveBeenCalled();
	});

	test('an ancestor registration outranks the descendant it wraps', () => {
		// React flushes a parent's effects after its children's, so the ancestor
		// pushes onto the stack last and wins — the opposite of what nesting reads
		// like. This is why a command whose behaviour depends on view-local state
		// (settings.open closes the command palette) gets exactly one registrant,
		// in the view that owns that state, and none at the router root.
		const ancestor = vi.fn();
		const descendant = vi.fn();
		renderWithProviders(
			harness(
				<Registrant command='settings.open' handler={ancestor}>
					<Registrant command='settings.open' handler={descendant} />
				</Registrant>,
			),
		);

		emit('settings.open');

		expect(ancestor).toHaveBeenCalledTimes(1);
		expect(descendant).not.toHaveBeenCalled();
	});

	test('a disabled registration does not handle the command', () => {
		const handler = vi.fn();
		renderWithProviders(
			harness(
				<Registrant
					command='review.review'
					enabled={false}
					handler={handler}
				/>,
			),
		);

		emit('review.review');

		expect(handler).not.toHaveBeenCalled();
	});

	test('an unhandled command is a no-op', () => {
		renderWithProviders(harness(null));

		expect(() => emit('review.commitAndPush')).not.toThrow();
		expect(closeWindow).not.toHaveBeenCalled();
	});

	test('tab.close falls back to closing the window when nothing is registered', () => {
		renderWithProviders(harness(null));

		emit('tab.close');

		expect(closeWindow).toHaveBeenCalledTimes(1);
	});

	test('reports the registered commands after the debounce', () => {
		renderWithProviders(
			harness(<Registrant command='workspace.new' handler={vi.fn()} />),
		);

		expect(reported).toHaveLength(0);
		act(() => {
			vi.advanceTimersByTime(200);
		});

		expect(reported.at(-1)?.commands).toContain('workspace.new');
	});

	test('a burst of registrations reports once', () => {
		renderWithProviders(
			harness(
				<>
					<Registrant command='workspace.new' handler={vi.fn()} />
					<Registrant command='tab.new' handler={vi.fn()} />
					<Registrant command='run.setup' handler={vi.fn()} />
				</>,
			),
		);
		act(() => {
			vi.advanceTimersByTime(200);
		});

		expect(reported).toHaveLength(1);
		expect(reported[0].commands).toHaveLength(4);
	});

	test('tab.close is reported even with nothing registered, so ⌘W stays live', () => {
		// A disabled item would never fire its click, which is what makes the
		// window-close fallback above reachable at all.
		renderWithProviders(harness(null));
		act(() => {
			vi.advanceTimersByTime(200);
		});

		expect(reported.at(-1)?.commands).toEqual(['tab.close']);
	});

	test('tab.close is reported once when a view registers its own closer', () => {
		renderWithProviders(
			harness(<Registrant command='tab.close' handler={vi.fn()} />),
		);
		act(() => {
			vi.advanceTimersByTime(200);
		});

		expect(reported.at(-1)?.commands).toEqual(['tab.close']);
	});

	test('reports only the checked claims that read as on', () => {
		renderWithProviders(
			harness(
				<>
					<CheckedClaimant checked={true} command='theme.dark' />
					<CheckedClaimant checked={false} command='theme.light' />
				</>,
			),
		);
		act(() => {
			vi.advanceTimersByTime(200);
		});

		expect(reported.at(-1)?.checked).toEqual(['theme.dark']);
	});

	test('unmounting the newer checked claim restores the one beneath it', () => {
		const { rerender } = renderWithProviders(
			harness(
				<>
					<CheckedClaimant checked={true} command='layout.toggleDock' />
					<CheckedClaimant checked={false} command='layout.toggleDock' />
				</>,
			),
		);
		act(() => {
			vi.advanceTimersByTime(200);
		});
		expect(reported.at(-1)?.checked).toEqual([]);

		rerender(
			harness(<CheckedClaimant checked={true} command='layout.toggleDock' />),
		);
		act(() => {
			vi.advanceTimersByTime(200);
		});

		expect(reported.at(-1)?.checked).toEqual(['layout.toggleDock']);
	});
});
