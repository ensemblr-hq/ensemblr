// @vitest-environment happy-dom

import { fireEvent, screen, waitFor } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import type { ComponentProps } from 'react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import {
	computeQueuePanelCollapsedAtom,
	computeQueueSnapshotAtom,
} from '../../src/renderer/state/compute-queue';
import type {
	ComputeJobSnapshot,
	ComputeQueueSnapshot,
} from '../../src/shared/compute-queue';
import { renderWithProviders } from './support/dom';

const cancelComputeJob = vi.fn();
const toastError = vi.fn();
const openFilePreview = vi.fn();

vi.mock('sonner', () => ({ toast: { error: (m: string) => toastError(m) } }));
vi.mock('@/renderer/api/ensemblr', async (importOriginal) => {
	const actual =
		await importOriginal<typeof import('@/renderer/api/ensemblr')>();
	return {
		...actual,
		cancelComputeJob: (id: string) => cancelComputeJob(id),
	};
});
vi.mock('@/renderer/hooks/concierge/use-concierge-file-preview', () => ({
	useConciergeFilePreview: () => ({
		openFilePreview: (path: string) => openFilePreview(path),
	}),
}));

const { ComputeQueuePanel, SidebarComputeQueuePanel } = await import(
	'../../src/renderer/components/workbench-shell/navigation-sidebar/compute-queue-panel'
);
const { WorkbenchLayoutModelProvider } = await import(
	'../../src/renderer/components/workbench-shell/shell-contexts'
);

/** Builds a job with sensible defaults; tests override only what they assert on. */
function job(overrides: Partial<ComputeJobSnapshot>): ComputeJobSnapshot {
	return {
		command: 'bun run test',
		endedAt: null,
		enqueuedAt: Date.now(),
		exitCode: null,
		id: 'job-1',
		initiator: 'agent',
		kind: 'command',
		label: 'bun run test',
		logPath: '/work/ws/.context/compute-queue/job-1.log',
		position: null,
		script: null,
		sessionId: null,
		signal: null,
		startedAt: null,
		state: 'queued',
		terminalId: null,
		workspaceId: 'ws-1',
		workspaceName: 'Workspace One',
		...overrides,
	};
}

/** Wraps jobs in a snapshot with one slot in use. */
function queue(jobs: ComputeJobSnapshot[]): ComputeQueueSnapshot {
	return { enabled: true, inUse: 1, jobs, slots: 2 };
}

/** Renders the presentational panel expanded, with no-op actions unless a test overrides them. */
function renderPanel(
	snapshot: ComputeQueueSnapshot,
	overrides: Partial<ComponentProps<typeof ComputeQueuePanel>> = {},
) {
	return renderWithProviders(
		<ComputeQueuePanel
			collapsed={false}
			onCancel={() => undefined}
			onCollapsedChange={() => undefined}
			onOpenLog={() => undefined}
			snapshot={snapshot}
			{...overrides}
		/>,
	);
}

describe('ComputeQueuePanel', () => {
	test('renders nothing when no job is queued or running', () => {
		const { container } = renderPanel(
			queue([
				job({ id: 'done', state: 'succeeded' }),
				job({ id: 'bad', state: 'failed' }),
			]),
		);

		expect(container.querySelector('[data-sidebar-compute-queue]')).toBeNull();
	});

	test('lists running jobs before queued ones, queued by position', () => {
		const { container } = renderPanel(
			queue([
				job({ id: 'q2', label: 'second', position: 2 }),
				job({ id: 'q1', label: 'first', position: 1 }),
				job({
					id: 'r1',
					label: 'running',
					startedAt: Date.now(),
					state: 'running',
				}),
			]),
		);

		const rows = [...container.querySelectorAll('[data-compute-job-state]')];
		expect(
			rows.map((row) => row.getAttribute('data-compute-job-state')),
		).toEqual(['running', 'queued', 'queued']);
		expect(rows.map((row) => row.textContent)).toEqual([
			expect.stringContaining('running'),
			expect.stringContaining('first'),
			expect.stringContaining('second'),
		]);
		expect(screen.getByText('#1')).toBeTruthy();
		expect(screen.getByText('#1 in queue').className).toContain('sr-only');
	});

	test('shows slot usage as a bare ratio once there is more than one slot', () => {
		const { container } = renderPanel(queue([job({ position: 1 })]));

		const slots = container.querySelector('[data-compute-queue-slots]');
		expect(slots?.querySelector('[aria-hidden="true"]')?.textContent).toBe(
			'1/2',
		);
		expect(slots?.querySelector('.sr-only')?.textContent).toBe(
			'1 of 2 slots in use',
		);
	});

	test('leaves slot usage out with a single slot', () => {
		const { container } = renderPanel({
			enabled: true,
			inUse: 1,
			jobs: [job({ startedAt: Date.now(), state: 'running' })],
			slots: 1,
		});

		expect(container.querySelector('[data-compute-queue-slots]')).toBeNull();
	});

	test('shows a single slot once a user script pushes usage past it', () => {
		const { container } = renderPanel({
			enabled: true,
			inUse: 2,
			jobs: [
				job({ id: 'a', startedAt: Date.now(), state: 'running' }),
				job({
					id: 'b',
					initiator: 'user',
					startedAt: Date.now(),
					state: 'running',
				}),
			],
			slots: 1,
		});

		expect(
			container.querySelector('[data-compute-queue-slots] [aria-hidden="true"]')
				?.textContent,
		).toBe('2/1');
	});

	test('a queued job offers cancel and reports its id', () => {
		const onCancel = vi.fn();
		renderPanel(queue([job({ id: 'q1', label: 'bun build', position: 1 })]), {
			onCancel,
		});

		fireEvent.click(screen.getByRole('button', { name: 'Cancel bun build' }));

		expect(onCancel).toHaveBeenCalledWith('q1');
		expect(screen.queryByRole('button', { name: /^Stop/ })).toBeNull();
	});

	test('a running job offers stop rather than cancel', () => {
		const onCancel = vi.fn();
		renderPanel(
			queue([
				job({
					id: 'r1',
					label: 'bun build',
					startedAt: Date.now(),
					state: 'running',
				}),
			]),
			{ onCancel },
		);

		fireEvent.click(screen.getByRole('button', { name: 'Stop bun build' }));

		expect(onCancel).toHaveBeenCalledWith('r1');
		expect(screen.queryByRole('button', { name: /^Cancel/ })).toBeNull();
	});

	test('offers the log for command jobs only', () => {
		const onOpenLog = vi.fn();
		const command = job({ id: 'c', label: 'cmd', position: 1 });
		renderPanel(
			queue([
				command,
				job({
					id: 's',
					kind: 'script',
					label: 'setup',
					logPath: null,
					position: 2,
					script: { kind: 'setup', name: null },
				}),
			]),
			{ onOpenLog },
		);

		const buttons = screen.getAllByRole('button', { name: 'Open log' });
		expect(buttons).toHaveLength(1);
		fireEvent.click(buttons[0] as HTMLElement);
		expect(onOpenLog).toHaveBeenCalledWith(command);
	});

	test('names a script job by what it is rather than by its command', () => {
		const { container } = renderPanel(
			queue([
				job({
					command: 'scripts/setup.sh',
					id: 'setup',
					initiator: 'auto',
					kind: 'script',
					label: 'scripts/setup.sh',
					logPath: null,
					position: 1,
					script: { kind: 'setup', name: null },
				}),
				job({
					command: 'bun run dev',
					id: 'run',
					kind: 'script',
					label: 'bun run dev',
					logPath: null,
					position: 2,
					script: { kind: 'run', name: 'dev-server' },
				}),
			]),
		);

		const rows = [...container.querySelectorAll('[data-compute-job-state]')];
		expect(rows[0]?.textContent).toContain('Setup script');
		expect(rows[0]?.textContent).not.toContain('scripts/setup.sh');
		expect(rows[1]?.textContent).toContain('Run script: Dev server');
		expect(
			screen.getByRole('button', { name: 'Cancel Setup script' }),
		).toBeTruthy();
	});

	test('labels an app-started job as automatic', () => {
		renderPanel(
			queue([
				job({
					id: 'q1',
					initiator: 'auto',
					kind: 'script',
					position: 1,
					script: { kind: 'setup', name: null },
				}),
			]),
		);

		expect(screen.getByText('Auto')).toBeTruthy();
	});

	test('the workspace name opens the workspace when the host resolves it', () => {
		const openWorkspace = vi.fn();
		const workspaceOpener = vi.fn(() => openWorkspace);
		const queued = job({ id: 'q1', position: 1 });
		renderPanel(queue([queued]), { workspaceOpener });

		fireEvent.click(
			screen.getByRole('button', { name: 'Open workspace Workspace One' }),
		);

		expect(workspaceOpener).toHaveBeenCalledWith(queued);
		expect(openWorkspace).toHaveBeenCalledTimes(1);
	});

	test('the workspace name is plain text without a navigation host', () => {
		renderPanel(queue([job({ id: 'q1', position: 1 })]));

		expect(screen.getByText('Workspace One')).toBeTruthy();
		expect(screen.queryByRole('button', { name: /Open workspace/ })).toBeNull();
	});

	test('the workspace name is plain text when the host cannot resolve it', () => {
		renderPanel(queue([job({ id: 'q1', position: 1 })]), {
			workspaceOpener: () => null,
		});

		expect(screen.getByText('Workspace One')).toBeTruthy();
		expect(screen.queryByRole('button', { name: /Open workspace/ })).toBeNull();
	});

	test('collapsing keeps the summary and hides the jobs', () => {
		const onCollapsedChange = vi.fn();
		const snapshot = queue([
			job({ id: 'q1', label: 'bun build', position: 1 }),
		]);
		const { container, rerender } = renderPanel(snapshot, {
			onCollapsedChange,
		});

		const toggle = screen.getByRole('button', { name: /Compute queue/ });
		expect(toggle.getAttribute('aria-expanded')).toBe('true');
		expect(screen.queryByText('0 running · 1 queued')).toBeNull();
		fireEvent.click(toggle);
		expect(onCollapsedChange).toHaveBeenCalledWith(true);

		rerender(
			<ComputeQueuePanel
				collapsed
				onCancel={() => undefined}
				onCollapsedChange={onCollapsedChange}
				onOpenLog={() => undefined}
				snapshot={snapshot}
			/>,
		);

		expect(container.querySelector('[data-compute-job-state]')).toBeNull();
		expect(screen.getByText('0 running · 1 queued').className).toContain(
			'sr-only',
		);
		expect(
			container.querySelector('[data-compute-queue-count="queued"]')
				?.textContent,
		).toBe('1');
		expect(
			container.querySelector('[data-compute-queue-count="running"]'),
		).toBeNull();
		expect(
			screen
				.getByRole('button', { name: /Compute queue/ })
				.getAttribute('aria-expanded'),
		).toBe('false');
	});
});

describe('SidebarComputeQueuePanel', () => {
	beforeEach(() => {
		cancelComputeJob.mockReset();
		toastError.mockReset();
		openFilePreview.mockReset();
	});

	test('opening a log hands its path to the shared file opener', () => {
		renderSidebar(queue([job({ id: 'q1', position: 1 })]));

		fireEvent.click(screen.getByRole('button', { name: 'Open log' }));

		expect(openFilePreview).toHaveBeenCalledWith(
			'/work/ws/.context/compute-queue/job-1.log',
		);
	});

	test('the workspace name navigates through the layout model', () => {
		const navigateToWorkspace = vi.fn();
		const layoutModel = {
			displayProjects: [
				{
					id: 'project-1',
					workspaces: [{ id: 'ws-1', name: 'Workspace One' }],
				},
			],
			navigateToWorkspace,
		} as unknown as ComponentProps<
			typeof WorkbenchLayoutModelProvider
		>['value'];
		const store = createStore();
		store.set(computeQueueSnapshotAtom, queue([job({ position: 1 })]));
		renderWithProviders(
			<Provider store={store}>
				<WorkbenchLayoutModelProvider value={layoutModel}>
					<SidebarComputeQueuePanel />
				</WorkbenchLayoutModelProvider>
			</Provider>,
		);

		fireEvent.click(
			screen.getByRole('button', { name: 'Open workspace Workspace One' }),
		);

		expect(navigateToWorkspace).toHaveBeenCalledWith('project-1', 'ws-1');
	});

	/** Renders the wired panel against a store holding the given snapshot. */
	function renderSidebar(snapshot: ComputeQueueSnapshot) {
		const store = createStore();
		store.set(computeQueueSnapshotAtom, snapshot);
		return renderWithProviders(
			<Provider store={store}>
				<SidebarComputeQueuePanel />
			</Provider>,
		);
	}

	test('announces only the summary through a hidden live node', () => {
		const { container } = renderSidebar(
			queue([
				job({ id: 'r', startedAt: Date.now(), state: 'running' }),
				job({ id: 'q', position: 1 }),
			]),
		);

		const live = container.querySelector('[aria-live]');
		expect(live?.textContent).toBe('1 running · 1 queued');
		expect(live?.className).toContain('sr-only');
		expect(
			container
				.querySelector('[data-sidebar-compute-queue]')
				?.closest('[aria-live]'),
		).toBeNull();
		const timer = container.querySelector(
			'[data-compute-job-state="running"] .tabular-nums',
		);
		expect(timer?.getAttribute('aria-hidden')).toBe('true');
		expect(
			container
				.querySelector('[data-compute-job-state="running"] [role="status"]')
				?.getAttribute('aria-hidden'),
		).toBe('true');
	});

	test('the live node stays mounted and empty when the queue is idle', () => {
		const { container } = renderSidebar(queue([]));

		expect(container.querySelector('[aria-live]')?.textContent).toBe('');
	});

	test('a cancel the queue refuses surfaces a toast', async () => {
		cancelComputeJob.mockResolvedValue({ cancelled: false });
		renderSidebar(queue([job({ id: 'q1', label: 'bun build', position: 1 })]));

		fireEvent.click(screen.getByRole('button', { name: 'Cancel bun build' }));

		await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1));
	});

	test('a cancel that throws surfaces a toast', async () => {
		const error = vi
			.spyOn(console, 'error')
			.mockImplementation(() => undefined);
		cancelComputeJob.mockRejectedValue(new Error('ipc down'));
		renderSidebar(queue([job({ id: 'q1', label: 'bun build', position: 1 })]));

		fireEvent.click(screen.getByRole('button', { name: 'Cancel bun build' }));

		await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1));
		error.mockRestore();
	});

	test('a successful cancel stays quiet', async () => {
		cancelComputeJob.mockResolvedValue({ cancelled: true });
		renderSidebar(queue([job({ id: 'q1', label: 'bun build', position: 1 })]));

		fireEvent.click(screen.getByRole('button', { name: 'Cancel bun build' }));

		await waitFor(() => expect(cancelComputeJob).toHaveBeenCalledWith('q1'));
		expect(toastError).not.toHaveBeenCalled();
	});

	test('collapsing the panel is remembered in the store', () => {
		const store = createStore();
		store.set(
			computeQueueSnapshotAtom,
			queue([job({ id: 'q1', label: 'bun build', position: 1 })]),
		);
		const { container } = renderWithProviders(
			<Provider store={store}>
				<SidebarComputeQueuePanel />
			</Provider>,
		);

		fireEvent.click(screen.getByRole('button', { name: /Compute queue/ }));

		expect(store.get(computeQueuePanelCollapsedAtom)).toBe(true);
		expect(container.querySelector('[data-compute-job-state]')).toBeNull();
	});

	test('shows no panel until a job is live', () => {
		const store = createStore();
		store.set(computeQueueSnapshotAtom, queue([job({ state: 'succeeded' })]));
		const { container } = renderWithProviders(
			<Provider store={store}>
				<SidebarComputeQueuePanel />
			</Provider>,
		);

		expect(container.querySelector('[data-sidebar-compute-queue]')).toBeNull();
	});
});
