// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';

import { SetupScriptOutputPanel } from '../../src/renderer/components/workbench-shell/dock-panel/setup-script-output';
import type { WorkspaceScriptSummary } from '../../src/renderer/types/workbench';

import { renderWithProviders } from './support/dom';

// XtermTerminal binds to a live PTY and renders via canvas, neither of which
// exists under happy-dom; stub it so the panel's own controls are what's tested.
vi.mock(
	'@/renderer/components/workbench-shell/dock-panel/xterm-terminal',
	() => ({
		XtermTerminal: () => <div data-testid='xterm' />,
	}),
);

/** Builds a script summary that reaches the terminal-output branch by default. */
function scriptSummary(
	overrides: Partial<WorkspaceScriptSummary> = {},
): WorkspaceScriptSummary {
	return { status: 'succeeded', terminalId: 't1', ...overrides };
}

/** Renders the panel with no-op handlers plus any overrides the test needs. */
function renderPanel(
	props: Partial<Parameters<typeof SetupScriptOutputPanel>[0]>,
) {
	const handlers = {
		onAskAgentSetupScript: vi.fn(),
		onOpenSetupScripts: vi.fn(),
		onRunSetupScript: vi.fn(),
		onStopSetupScript: vi.fn(),
	};
	renderWithProviders(
		<SetupScriptOutputPanel
			script={scriptSummary()}
			{...handlers}
			{...props}
		/>,
	);
	return handlers;
}

test('shows Rerun setup over a succeeded run and reruns on click', async () => {
	const user = userEvent.setup();
	const { onRunSetupScript } = renderPanel({
		script: scriptSummary({ status: 'succeeded' }),
	});

	expect(screen.getByTestId('xterm')).toBeInTheDocument();
	await user.click(screen.getByRole('button', { name: 'Rerun setup' }));

	expect(onRunSetupScript).toHaveBeenCalledTimes(1);
});

test('shows Rerun setup after a stopped run', () => {
	renderPanel({ script: scriptSummary({ status: 'stopped' }) });

	expect(
		screen.getByRole('button', { name: 'Rerun setup' }),
	).toBeInTheDocument();
});

test('shows Stop setup while the script is running and stops on click', async () => {
	const user = userEvent.setup();
	const { onStopSetupScript, onRunSetupScript } = renderPanel({
		script: scriptSummary({ status: 'running' }),
	});

	expect(screen.getByTestId('xterm')).toBeInTheDocument();
	expect(screen.queryByRole('button', { name: 'Rerun setup' })).toBeNull();
	await user.click(screen.getByRole('button', { name: 'Stop setup' }));

	expect(onStopSetupScript).toHaveBeenCalledTimes(1);
	expect(onRunSetupScript).not.toHaveBeenCalled();
});

test('renders the not-run empty state without a setup control', () => {
	renderPanel({
		script: scriptSummary({ status: 'not-run', terminalId: null }),
	});

	expect(screen.queryByTestId('xterm')).toBeNull();
	expect(screen.queryByRole('button', { name: 'Rerun setup' })).toBeNull();
	expect(screen.queryByRole('button', { name: 'Stop setup' })).toBeNull();
});
