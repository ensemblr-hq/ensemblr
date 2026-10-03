// @vitest-environment happy-dom

import { fireEvent, screen, waitFor } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { computeQueueSnapshotAtom } from '../../src/renderer/state/compute-queue';
import type {
	ComputeJobSnapshot,
	ComputeQueueSnapshot,
} from '../../src/shared/compute-queue';
import { renderWithProviders } from './support/dom';

const cancelComputeJob = vi.fn();
const toastError = vi.fn();

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
	useConciergeFilePreview: () => ({ openFilePreview: undefined }),
}));

const { ComputeQueuePanel, SidebarComputeQueuePanel } = await import(
	'../../src/renderer/components/workbench-shell/navigation-sidebar/compute-queue-panel'
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

describe('ComputeQueuePanel', () => {
	test('renders nothing when no job is queued or running', () => {
		const { container } = renderWithProviders(
			<ComputeQueuePanel
				onCancel={() => undefined}
				onOpenLog={() => undefined}
				snapshot={queue([
					job({ id: 'done', state: 'succeeded' }),
					job({ id: 'bad', state: 'failed' }),
				])}
			/>,
		);

		expect(container.querySelector('[data-sidebar-compute-queue]')).toBeNull();
	});

	test('lists running jobs before queued ones, queued by position', () => {
		const { container } = renderWithProviders(
			<ComputeQueuePanel
				onCancel={() => undefined}
				onOpenLog={() => undefined}
				snapshot={queue([
					job({ id: 'q2', label: 'second', position: 2 }),
					job({ id: 'q1', label: 'first', position: 1 }),
					job({
						id: 'r1',
						label: 'running',
						startedAt: Date.now(),
						state: 'running',
					}),
				])}
			/>,
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
		expect(screen.getByText('1/2')).toBeTruthy();
	});

	test('cancel reports the job id', () => {
		const onCancel = vi.fn();
		renderWithProviders(
			<ComputeQueuePanel
				onCancel={onCancel}
				onOpenLog={() => undefined}
				snapshot={queue([job({ id: 'q1', label: 'bun build', position: 1 })])}
			/>,
		);

		fireEvent.click(screen.getByRole('button', { name: 'Cancel bun build' }));

		expect(onCancel).toHaveBeenCalledWith('q1');
	});

	test('offers the log for command jobs only', () => {
		const onOpenLog = vi.fn();
		const command = job({ id: 'c', label: 'cmd', position: 1 });
		renderWithProviders(
			<ComputeQueuePanel
				onCancel={() => undefined}
				onOpenLog={onOpenLog}
				snapshot={queue([
					command,
					job({
						id: 's',
						kind: 'script',
						label: 'setup',
						logPath: null,
						position: 2,
					}),
				])}
			/>,
		);

		const buttons = screen.getAllByRole('button', { name: 'Open log' });
		expect(buttons).toHaveLength(1);
		fireEvent.click(buttons[0] as HTMLElement);
		expect(onOpenLog).toHaveBeenCalledWith(command);
	});
});

describe('SidebarComputeQueuePanel', () => {
	beforeEach(() => {
		cancelComputeJob.mockReset();
		toastError.mockReset();
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
