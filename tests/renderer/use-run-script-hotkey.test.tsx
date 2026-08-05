// @vitest-environment happy-dom

import { renderHook } from '@testing-library/react';
import { expect, test, vi } from 'vitest';

import { useRunScriptHotkey } from '@/renderer/hooks/workbench-shell/dock-panel/use-run-script-hotkey';
import type { WorkspaceScriptSummary } from '@/renderer/types/workbench';
import { matchesShortcut } from '@/shared/keymap';
import type { RunScriptDefinition } from '@/shared/scripts';

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

const DEV_RUN_SCRIPT: RunScriptDefinition = {
	availableIn: null,
	command: 'npm run dev',
	icon: 'play',
	isDefault: true,
	name: 'dev',
};

/** Mounts the hook at `status` with fresh start/stop spies. */
function setup(
	status: WorkspaceScriptSummary['status'],
	activeRunScript: RunScriptDefinition | null = DEV_RUN_SCRIPT,
) {
	const onRunScript = vi.fn();
	const onStopRunScript = vi.fn();
	renderHook(() =>
		useRunScriptHotkey(
			status,
			{ onRunScript, onStopRunScript },
			activeRunScript,
		),
	);
	return { onRunScript, onStopRunScript };
}

test('⌘R stops the run script while it is running', () => {
	const { onRunScript, onStopRunScript } = setup('running');

	dispatchRunHotkey();

	expect(onStopRunScript).toHaveBeenCalledTimes(1);
	expect(onRunScript).not.toHaveBeenCalled();
});

test.each<WorkspaceScriptSummary['status']>([
	'not-run',
	'stopped',
	'succeeded',
])('⌘R starts the run script when status is %s', (status) => {
	const { onRunScript, onStopRunScript } = setup(status);

	dispatchRunHotkey();

	expect(onRunScript).toHaveBeenCalledExactlyOnceWith('dev');
	expect(onStopRunScript).not.toHaveBeenCalled();
});

test('⌘R is a no-op when no run script is configured', () => {
	const { onRunScript, onStopRunScript } = setup('missing', null);

	dispatchRunHotkey();

	expect(onRunScript).not.toHaveBeenCalled();
	expect(onStopRunScript).not.toHaveBeenCalled();
});

test('⌘R is captured (default reload suppressed) even when missing', () => {
	setup('missing', null);

	// preventDefault must fire regardless of run status, otherwise ⌘R falls
	// through to a native Electron reload.
	expect(dispatchRunHotkey().defaultPrevented).toBe(true);
});
