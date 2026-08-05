// @vitest-environment happy-dom

import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';

import { DockPanelActions } from '@/renderer/components/workbench-shell/dock-panel/actions';
import type {
	WorkspaceScriptSummary,
	WorkspaceShellModel,
} from '@/renderer/types/workbench';
import type { WorkbenchDockActions } from '@/renderer/types/workbench-shell';
import type { RunScriptDefinition } from '@/shared/scripts';

import { renderWithProviders } from './support/dom';

const DEV: RunScriptDefinition = {
	availableIn: null,
	command: 'npm run dev',
	icon: 'server',
	isDefault: true,
	name: 'dev',
};

const CHECKS: RunScriptDefinition = {
	availableIn: null,
	command: 'npm run check',
	icon: 'list-checks',
	isDefault: false,
	name: 'checks',
};

/** Renders the dock actions over a minimal workspace stub. */
function renderActions({
	activeRunScript = DEV,
	run = { status: 'not-run' },
	runScripts = [DEV, CHECKS],
}: {
	activeRunScript?: RunScriptDefinition | null;
	run?: WorkspaceScriptSummary;
	runScripts?: RunScriptDefinition[];
} = {}) {
	const actions = {
		onOpenRunPort: vi.fn(),
		onOpenSetupScripts: vi.fn(),
		onRunScript: vi.fn(),
		onStopRunScript: vi.fn(),
	} as unknown as WorkbenchDockActions;
	const workspace = {
		configuredPreviewUrls: [],
		name: 'monterrey',
		runScripts,
		scripts: { run, setup: { status: 'missing' } },
	} as unknown as WorkspaceShellModel;

	renderWithProviders(
		<DockPanelActions
			actions={actions}
			activeRunScript={activeRunScript}
			workspace={workspace}
		/>,
	);

	return actions;
}

test('the primary button runs the active script', async () => {
	const actions = renderActions();

	await userEvent.click(screen.getByRole('button', { name: 'Run Dev' }));

	expect(actions.onRunScript).toHaveBeenCalledExactlyOnceWith('dev');
});

test('the dropdown lists every configured script plus Configure', async () => {
	const actions = renderActions();

	await userEvent.click(
		screen.getByRole('button', { name: 'Choose run script' }),
	);

	expect(
		screen.getAllByRole('menuitem').map((item) => item.textContent),
	).toEqual(['Dev', 'Checks', 'Configure']);

	await userEvent.click(screen.getByRole('menuitem', { name: 'Checks' }));
	expect(actions.onRunScript).toHaveBeenCalledExactlyOnceWith('checks');
});

test('Configure opens the repository Scripts settings', async () => {
	const actions = renderActions();

	await userEvent.click(
		screen.getByRole('button', { name: 'Choose run script' }),
	);
	await userEvent.click(screen.getByRole('menuitem', { name: 'Configure' }));

	expect(actions.onOpenSetupScripts).toHaveBeenCalledTimes(1);
	expect(actions.onRunScript).not.toHaveBeenCalled();
});

test('menu items never wrap their label', async () => {
	renderActions();

	await userEvent.click(
		screen.getByRole('button', { name: 'Choose run script' }),
	);

	for (const item of screen.getAllByRole('menuitem')) {
		expect(item).toHaveClass('whitespace-nowrap');
	}
});

test('the run button carries the shortcut hint', () => {
	renderActions();

	expect(screen.getByRole('button', { name: 'Run Dev' })).toHaveTextContent(
		/R$/,
	);
});

test('the stop button carries the shortcut hint', () => {
	renderActions({ run: { scriptName: 'dev', status: 'running' } });

	expect(
		screen.getByRole('button', { name: 'Stop run script' }),
	).toHaveTextContent(/R$/);
});

test('a lone run script renders without the dropdown', () => {
	renderActions({ runScripts: [DEV] });

	expect(screen.getByRole('button', { name: 'Run Dev' })).toBeInTheDocument();
	expect(
		screen.queryByRole('button', { name: 'Choose run script' }),
	).not.toBeInTheDocument();
});

test('a running script swaps the control for Stop', async () => {
	const actions = renderActions({
		run: { scriptName: 'checks', status: 'running' },
	});

	expect(
		screen.queryByRole('button', { name: 'Run Dev' }),
	).not.toBeInTheDocument();
	await userEvent.click(
		screen.getByRole('button', { name: 'Stop run script' }),
	);

	expect(actions.onStopRunScript).toHaveBeenCalledTimes(1);
});

test('nothing renders when the repository configures no run scripts', () => {
	renderActions({
		activeRunScript: null,
		run: { status: 'missing' },
		runScripts: [],
	});

	expect(screen.queryByRole('button')).not.toBeInTheDocument();
});
