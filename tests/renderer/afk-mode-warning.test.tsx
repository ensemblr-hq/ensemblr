// @vitest-environment happy-dom

import { act, renderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createStore, Provider } from 'jotai';
import type { PropsWithChildren } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { AfkModeWarningDialog } from '../../src/renderer/components/workbench-shell/conversation-panel/composer/afk-mode-warning-dialog';
import { ComposerPanel } from '../../src/renderer/components/workbench-shell/conversation-panel/composer-panel';
import { useAfkModeWarning } from '../../src/renderer/hooks/workbench-shell/composer/use-afk-mode-warning';
import { menuCommandHandlersAtom } from '../../src/renderer/state/menu-commands/atoms';
import { hasAcknowledgedAfkModeWarningAtom } from '../../src/renderer/state/preferences';
import { createComposerShellState } from './support/composer';
import { renderWithProviders } from './support/dom';

function renderWarning(
	onChange = vi.fn<(afkMode: boolean) => void>(),
	initialEnabled = true,
) {
	const store = createStore();
	store.set(hasAcknowledgedAfkModeWarningAtom, false);
	const wrapper = ({ children }: PropsWithChildren) => (
		<Provider store={store}>{children}</Provider>
	);
	const hook = renderHook(
		({ enabled }) => useAfkModeWarning(onChange, enabled),
		{ initialProps: { enabled: initialEnabled }, wrapper },
	);
	return { ...hook, onChange, store };
}

beforeEach(() => {
	localStorage.clear();
});

afterEach(() => {
	localStorage.clear();
});

describe('AFK mode first-use warning', () => {
	test('explains the tradeoff and offers both decisions', async () => {
		const onAcknowledge = vi.fn();
		const onGoBack = vi.fn();
		renderWithProviders(
			<AfkModeWarningDialog
				onAcknowledge={onAcknowledge}
				onGoBack={onGoBack}
				open
			/>,
		);

		expect(screen.getByText('Before you turn on AFK')).toBeInTheDocument();
		expect(screen.getByText(/absolute best work/)).toBeInTheDocument();
		expect(screen.getByText(/substantially more tokens/)).toBeInTheDocument();
		expect(
			screen.queryByRole('button', { name: 'Close' }),
		).not.toBeInTheDocument();

		await userEvent.click(screen.getByRole('button', { name: 'Not now' }));
		expect(onGoBack).toHaveBeenCalledOnce();
		expect(onAcknowledge).not.toHaveBeenCalled();
	});

	test('keeps asking after the user goes back', () => {
		const { onChange, result, store } = renderWarning();

		act(() => result.current.requestChange(true));
		expect(result.current.open).toBe(true);
		expect(onChange).not.toHaveBeenCalled();

		act(() => result.current.goBack());
		expect(result.current.open).toBe(false);
		expect(store.get(hasAcknowledgedAfkModeWarningAtom)).toBe(false);

		act(() => result.current.requestChange(true));
		expect(result.current.open).toBe(true);
		expect(onChange).not.toHaveBeenCalled();
	});

	test('acknowledges once, activates AFK, and skips future warnings', () => {
		const { onChange, result, store } = renderWarning();

		act(() => result.current.requestChange(true));
		act(() => result.current.acknowledge());

		expect(result.current.open).toBe(false);
		expect(store.get(hasAcknowledgedAfkModeWarningAtom)).toBe(true);
		expect(onChange).toHaveBeenLastCalledWith(true);

		act(() => result.current.requestChange(false));
		act(() => result.current.requestChange(true));

		expect(result.current.open).toBe(false);
		expect(onChange).toHaveBeenNthCalledWith(2, false);
		expect(onChange).toHaveBeenNthCalledWith(3, true);
	});

	test('cancels delayed confirmation after activation becomes disabled', () => {
		const { onChange, rerender, result, store } = renderWarning();

		act(() => result.current.requestChange(true));
		rerender({ enabled: false });
		act(() => result.current.acknowledge());

		expect(result.current.open).toBe(false);
		expect(store.get(hasAcknowledgedAfkModeWarningAtom)).toBe(false);
		expect(onChange).not.toHaveBeenCalled();
	});

	test('persists acknowledgment across stores and hook remounts', () => {
		const first = renderWarning();
		act(() => first.result.current.requestChange(true));
		act(() => first.result.current.acknowledge());
		first.unmount();

		const onChange = vi.fn<(afkMode: boolean) => void>();
		const store = createStore();
		const wrapper = ({ children }: PropsWithChildren) => (
			<Provider store={store}>{children}</Provider>
		);
		const { result } = renderHook(() => useAfkModeWarning(onChange, true), {
			wrapper,
		});

		act(() => result.current.requestChange(true));

		expect(result.current.open).toBe(false);
		expect(onChange).toHaveBeenCalledWith(true);
	});

	test('gates the composer toggle and native-menu activation paths', async () => {
		const onChange = vi.fn<(afkMode: boolean) => void>();
		const store = createStore();
		store.set(hasAcknowledgedAfkModeWarningAtom, false);
		const composer = {
			...createComposerShellState(),
			disabled: false,
			onAfkModeChange: onChange,
		};
		renderWithProviders(
			<Provider store={store}>
				<ComposerPanel
					chatTabId='afk-warning-integration'
					composer={composer}
					repositoryId='repo-afk-warning'
					workspaceId='workspace-afk-warning'
				/>
			</Provider>,
		);

		await userEvent.click(
			screen.getByRole('button', {
				name: 'AFK mode: off. Click to toggle.',
			}),
		);
		expect(screen.getByText('Before you turn on AFK')).toBeInTheDocument();
		expect(onChange).not.toHaveBeenCalled();
		await userEvent.click(screen.getByRole('button', { name: 'Not now' }));

		const menuHandler = store
			.get(menuCommandHandlersAtom)
			['composer.toggleAfkMode']?.at(-1);
		expect(menuHandler).toBeDefined();
		act(() => menuHandler?.());

		expect(screen.getByText('Before you turn on AFK')).toBeInTheDocument();
		expect(onChange).not.toHaveBeenCalled();
		await userEvent.click(screen.getByRole('button', { name: 'Turn on AFK' }));
		expect(onChange).toHaveBeenCalledWith(true);
	});
});
