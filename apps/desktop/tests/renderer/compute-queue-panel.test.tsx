// @vitest-environment happy-dom

import { fireEvent, screen } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import { describe, expect, test, vi } from 'vitest';

import {
	ComputeQueuePanel,
	SidebarComputeQueuePanel,
} from '../../src/renderer/components/workbench-shell/navigation-sidebar/compute-queue-panel';
import { computeQueueSnapshotAtom } from '../../src/renderer/state/compute-queue';
import type {
	ComputeJobSnapshot,
	ComputeQueueSnapshot,
} from '../../src/shared/compute-queue';
import { renderWithProviders } from './support/dom';

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
