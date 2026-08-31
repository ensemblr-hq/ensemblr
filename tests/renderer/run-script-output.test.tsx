// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';

import { RunScriptOutputPanel } from '../../src/renderer/components/workbench-shell/dock-panel/run-script-output';
import type { WorkspaceScriptSummary } from '../../src/renderer/types/workbench';

import { renderWithProviders } from './support/dom';

vi.mock(
	'@/renderer/components/workbench-shell/dock-panel/xterm-terminal',
	() => ({
		XtermTerminal: () => <div data-testid='xterm' />,
	}),
);

/** Renders the panel in its stopped state with any overrides the test needs. */
function renderPanel(
	props: Partial<Parameters<typeof RunScriptOutputPanel>[0]> = {},
) {
	const handlers = {
		onOpenSetupScripts: vi.fn(),
		onRunScript: vi.fn(),
	};
	const script: WorkspaceScriptSummary = { status: 'stopped' };
	renderWithProviders(
		<RunScriptOutputPanel
			activeRunScriptName='dev'
			script={script}
			tabLabel='Run'
			workspaceCwd='/repo'
			{...props}
			{...handlers}
		/>,
	);
	return handlers;
}

test('starts the active run script by name when Start Run is clicked', async () => {
	const user = userEvent.setup();
	const { onRunScript } = renderPanel();

	await user.click(screen.getByRole('button', { name: /Start Run/ }));

	expect(onRunScript).toHaveBeenCalledTimes(1);
	expect(onRunScript).toHaveBeenCalledWith('dev');
});

test('never forwards the click event as the script name', async () => {
	const user = userEvent.setup();
	const { onRunScript } = renderPanel({ activeRunScriptName: null });

	await user.click(screen.getByRole('button', { name: /Start Run/ }));

	expect(onRunScript).toHaveBeenCalledWith(undefined);
});

test('offers the Setup Scripts action when no run script is configured', async () => {
	const user = userEvent.setup();
	const { onOpenSetupScripts, onRunScript } = renderPanel({
		activeRunScriptName: null,
		script: { status: 'missing' },
	});

	expect(screen.queryByRole('button', { name: /Start Run/ })).toBeNull();
	await user.click(screen.getByRole('button', { name: 'Setup Scripts' }));

	expect(onOpenSetupScripts).toHaveBeenCalledTimes(1);
	expect(onRunScript).not.toHaveBeenCalled();
});

test('renders the terminal once the run script owns a session', () => {
	renderPanel({ script: { status: 'running', terminalId: 't1' } });

	expect(screen.getByTestId('xterm')).toBeInTheDocument();
	expect(screen.queryByRole('button', { name: /Start Run/ })).toBeNull();
});
