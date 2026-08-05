// @vitest-environment happy-dom

import { renderHook } from '@testing-library/react';
import { expect, test, vi } from 'vitest';

import { useRunScriptHotkey } from '@/renderer/hooks/workbench-shell/dock-panel/use-run-script-hotkey';
import type { WorkspaceRunTargetSummary } from '@/renderer/types/workbench';
import { matchesShortcut } from '@/shared/keymap';

/**
 * Dispatches a ⌘R / Ctrl+R `keydown` matching the `run.start` binding on the
 * current platform (`mod` resolves to ⌘ on macOS, Ctrl elsewhere) and returns
 * the dispatched event so callers can inspect `defaultPrevented`.
 */
function dispatchRunHotkey(): KeyboardEvent {
	const meta = new KeyboardEvent('keydown', {
		bubbles: true,
		cancelable: true,
		key: 'r',
		metaKey: true,
	});
	const event = matchesShortcut('run.start', meta)
		? meta
		: new KeyboardEvent('keydown', {
				bubbles: true,
				cancelable: true,
				ctrlKey: true,
				key: 'r',
			});
	window.dispatchEvent(event);
	return event;
}

function target(
	id: string,
	status: WorkspaceRunTargetSummary['status'],
): WorkspaceRunTargetSummary {
	return { command: 'bun run dev', id, name: id, status };
}

/** Mounts the hook against `runTargets` with fresh start/stop spies. */
function setup(runTargets: WorkspaceRunTargetSummary[]) {
	const onRunScript = vi.fn();
	const onStopRunScript = vi.fn();
	const view = renderHook(
		(targets: WorkspaceRunTargetSummary[]) =>
			useRunScriptHotkey(targets, { onRunScript, onStopRunScript }),
		{ initialProps: runTargets },
	);
	return { onRunScript, onStopRunScript, view };
}

test('⌘R stops the sole run target while it is running', () => {
	const { onRunScript, onStopRunScript } = setup([
		target('default', 'running'),
	]);

	dispatchRunHotkey();

	expect(onStopRunScript).toHaveBeenCalledExactlyOnceWith('default');
	expect(onRunScript).not.toHaveBeenCalled();
});

test.each<WorkspaceRunTargetSummary['status']>([
	'not-run',
	'stopped',
	'succeeded',
])('⌘R starts the sole run target when status is %s', (status) => {
	const { onRunScript, onStopRunScript } = setup([target('default', status)]);

	dispatchRunHotkey();

	expect(onRunScript).toHaveBeenCalledExactlyOnceWith('default');
	expect(onStopRunScript).not.toHaveBeenCalled();
});

test('⌘R is a no-op when no run target is configured', () => {
	const { onRunScript, onStopRunScript } = setup([]);

	dispatchRunHotkey();

	expect(onRunScript).not.toHaveBeenCalled();
	expect(onStopRunScript).not.toHaveBeenCalled();
});

test('⌘R is captured (default reload suppressed) even with no run targets', () => {
	setup([]);

	// preventDefault must fire regardless of run status, otherwise ⌘R falls
	// through to a native Electron reload.
	expect(dispatchRunHotkey().defaultPrevented).toBe(true);
});

test('⌘R acts on the first configured target before any target has been used', () => {
	const { onRunScript } = setup([
		target('web', 'stopped'),
		target('api', 'stopped'),
	]);

	dispatchRunHotkey();

	expect(onRunScript).toHaveBeenCalledExactlyOnceWith('web');
});

test('⌘R re-targets the last-used run target on a later press', () => {
	const { onRunScript, onStopRunScript, view } = setup([
		target('web', 'stopped'),
		target('api', 'stopped'),
	]);

	dispatchRunHotkey();
	expect(onRunScript).toHaveBeenCalledExactlyOnceWith('web');

	// api starts running; re-render with fresh statuses (as the live model would).
	view.rerender([target('web', 'stopped'), target('api', 'running')]);
	dispatchRunHotkey();

	// The hotkey still targets 'web' (the last id it acted on) since 'web' is
	// still stopped, not 'api'.
	expect(onRunScript).toHaveBeenCalledTimes(2);
	expect(onStopRunScript).not.toHaveBeenCalled();
});
