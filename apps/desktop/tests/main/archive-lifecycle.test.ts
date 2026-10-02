import assert from 'node:assert/strict';
import test from 'node:test';

import { createArchiveLifecycleService } from '../../src/main/repository/archive-lifecycle.ts';
import type { ArchiveLifecycleContext } from '../../src/shared/ipc';

function baseContext(): Omit<ArchiveLifecycleContext, 'stage'> {
	return {
		archivedAt: '2026-06-08T12:00:00.000Z',
		archivedContextPath: '/tmp/archived/demo/workspace-ts',
		branchCleanup: false,
		repository: {
			id: 'repository-demo',
			name: 'demo',
			path: '/tmp/repos/demo',
			slug: 'demo',
		},
		workspace: {
			branchName: 'demo-branch',
			id: 'workspace-demo',
			name: 'Demo workspace',
			path: '/tmp/workspaces/demo/workspace',
			repositoryId: 'repository-demo',
			slug: 'workspace',
		},
	};
}

test('handlers fire in priority order then registration order', async () => {
	const service = createArchiveLifecycleService();
	const order: string[] = [];

	service.subscribe('pre-archive-workspace', () => {
		order.push('default-a');
		return {};
	});
	service.subscribe('pre-archive-workspace', () => {
		order.push('default-b');
		return {};
	});
	service.subscribe(
		'pre-archive-workspace',
		() => {
			order.push('high-priority');
			return {};
		},
		10,
	);

	const outcome = await service.invoke('pre-archive-workspace', baseContext());

	assert.deepEqual(order, ['high-priority', 'default-a', 'default-b']);
	assert.equal(outcome.aborted, null);
	assert.deepEqual(outcome.diagnostics, []);
});

test('pre-stage abort short-circuits subsequent handlers and surfaces diagnostics', async () => {
	const service = createArchiveLifecycleService();
	const order: string[] = [];

	service.subscribe('pre-archive-workspace', () => {
		order.push('first');
		return {
			diagnostics: [
				{
					code: 'first-warning',
					message: 'first warning',
					severity: 'warning',
				},
			],
		};
	});
	service.subscribe('pre-archive-workspace', () => {
		order.push('aborter');
		return {
			abort: { code: 'veto', message: 'work in progress' },
			diagnostics: [
				{
					code: 'abort-reason',
					message: 'work in progress',
					severity: 'error',
				},
			],
		};
	});
	service.subscribe('pre-archive-workspace', () => {
		order.push('never-runs');
		return {};
	});

	const outcome = await service.invoke('pre-archive-workspace', baseContext());

	assert.deepEqual(order, ['first', 'aborter']);
	assert.deepEqual(outcome.aborted, {
		code: 'veto',
		message: 'work in progress',
	});
	assert.equal(outcome.diagnostics.length, 2);
	assert.equal(outcome.diagnostics[0]?.code, 'first-warning');
	assert.equal(outcome.diagnostics[0]?.stage, 'pre-archive-workspace');
	assert.equal(outcome.diagnostics[1]?.code, 'abort-reason');
});

test('post-stage handlers cannot abort and thrown errors surface as warnings', async () => {
	const service = createArchiveLifecycleService();
	const order: string[] = [];

	service.subscribe('post-archive-workspace', () => {
		order.push('thrower');
		throw new Error('subscriber boom');
	});
	service.subscribe('post-archive-workspace', () => {
		order.push('still-runs');
		return {
			abort: { code: 'ignored', message: 'post abort ignored' },
		};
	});

	const outcome = await service.invoke('post-archive-workspace', baseContext());

	assert.deepEqual(order, ['thrower', 'still-runs']);
	assert.equal(outcome.aborted, null);
	assert.equal(outcome.diagnostics.length, 1);
	assert.equal(outcome.diagnostics[0]?.code, 'lifecycle-hook-failed');
	assert.equal(outcome.diagnostics[0]?.message, 'subscriber boom');
});

test('unsubscribe removes the handler', async () => {
	const service = createArchiveLifecycleService();
	let ran = 0;

	const unsubscribe = service.subscribe('pre-archive-workspace', () => {
		ran += 1;
		return {};
	});

	await service.invoke('pre-archive-workspace', baseContext());
	assert.equal(ran, 1);

	unsubscribe();
	await service.invoke('pre-archive-workspace', baseContext());
	assert.equal(ran, 1);
});
