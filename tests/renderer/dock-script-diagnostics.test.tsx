// @vitest-environment happy-dom

import { renderHook } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';

import type { WorkbenchDockActions } from '@/renderer/types/workbench-shell';
import type {
	CreateTerminalSessionResult,
	TerminalDiagnostic,
} from '@/shared/ipc/contracts/terminal';

import { installLocalStorage } from './support/dom';

const runWorkspaceScript = vi.fn();
const stopWorkspaceScript = vi.fn();
const toastError = vi.fn();
const toastWarning = vi.fn();

vi.mock('@tanstack/react-router', () => ({ useNavigate: () => vi.fn() }));

vi.mock('sonner', () => ({
	toast: { error: toastError, warning: toastWarning },
}));

vi.mock('@/renderer/api/ensemblr/workspace-scripts', () => ({
	runWorkspaceScript: (...args: unknown[]) => runWorkspaceScript(...args),
	stopWorkspaceScript: (...args: unknown[]) => stopWorkspaceScript(...args),
}));

const { useWorkspaceDockActions } = await import(
	'@/renderer/state/workspace/dock-actions'
);

/** A session-less script result carrying one diagnostic, as main answers a refusal. */
function refusedWith(
	diagnostic: TerminalDiagnostic,
): CreateTerminalSessionResult {
	return { diagnostics: [diagnostic], session: null };
}

/** Mounts the dock actions over stub terminal plumbing and returns them. */
function renderActions(): WorkbenchDockActions {
	const { result } = renderHook(() =>
		useWorkspaceDockActions({
			activeDockTab: 'run',
			askAgentSetupScript: vi.fn(),
			closeTerminal: vi.fn(),
			createTerminal: vi.fn(),
			repositoryId: 'repo-1',
			sessions: [],
			updateSearch: vi.fn(),
			workspaceId: 'ws-1',
		}),
	);
	return result.current;
}

/** Lets the script promise and its `.then` settle before assertions run. */
function flush(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
	installLocalStorage();
	vi.clearAllMocks();
	runWorkspaceScript.mockResolvedValue({ diagnostics: [], session: null });
	stopWorkspaceScript.mockResolvedValue({ diagnostics: [], session: null });
});

test('reports a failed run-script spawn instead of resolving silently', async () => {
	runWorkspaceScript.mockResolvedValue(
		refusedWith({
			code: 'spawn-failed',
			message: 'npm: command not found',
			severity: 'error',
		}),
	);

	renderActions().onRunScript('dev');
	await flush();

	expect(toastError).toHaveBeenCalledWith('npm: command not found', {
		description: undefined,
	});
});

test('translates an error diagnostic whose code the failure table carries', async () => {
	runWorkspaceScript.mockResolvedValue(
		refusedWith({
			code: 'database-unavailable',
			message: 'SQLite is unavailable; the script cannot be resolved.',
			severity: 'error',
		}),
	);

	renderActions().onRunScript('dev');
	await flush();

	expect(toastError).toHaveBeenCalledWith(
		'The local database is unavailable, so nothing was changed.',
		{ description: undefined },
	);
});

test('keeps reporting a duplicate-run conflict as a warning', async () => {
	runWorkspaceScript.mockResolvedValue(
		refusedWith({
			code: 'script-already-running',
			message: 'The run script is already running.',
			severity: 'warning',
		}),
	);

	renderActions().onRunScript('dev');
	await flush();

	expect(toastWarning).toHaveBeenCalledWith(
		'The run script is already running.',
	);
	expect(toastError).not.toHaveBeenCalled();
});

test('stays quiet about an advisory warning on a session that did start', async () => {
	runWorkspaceScript.mockResolvedValue({
		diagnostics: [
			{
				code: 'base-env-unavailable',
				message:
					'The shell-derived terminal environment could not be resolved.',
				severity: 'warning',
			},
		],
		session: { id: 't1' },
	});

	renderActions().onRunScript('dev');
	await flush();

	expect(toastError).not.toHaveBeenCalled();
	expect(toastWarning).not.toHaveBeenCalled();
});

test('reports a failed setup-script spawn, not only the run script', async () => {
	runWorkspaceScript.mockResolvedValue(
		refusedWith({
			code: 'spawn-failed',
			message: 'sh: pnpm: not found',
			severity: 'error',
		}),
	);

	renderActions().onRunSetupScript();
	await flush();

	expect(toastError).toHaveBeenCalledWith('sh: pnpm: not found', {
		description: undefined,
	});
});

test('falls back to the translated headline when the stop call itself rejects', async () => {
	stopWorkspaceScript.mockRejectedValue(new Error('bridge unavailable'));

	renderActions().onStopRunScript();
	await flush();

	expect(toastError).toHaveBeenCalledWith(
		'The run script could not be stopped.',
	);
});

test('reports a failed setup-script stop', async () => {
	stopWorkspaceScript.mockRejectedValue(new Error('bridge unavailable'));

	renderActions().onStopSetupScript();
	await flush();

	expect(toastError).toHaveBeenCalledWith(
		'The setup script could not be stopped.',
	);
});
