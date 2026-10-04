import type {
	ComputeJobSnapshot,
	ComputeQueueSnapshot,
} from '@/shared/compute-queue';

/** Where the fixtures pretend this workspace's worktree lives. */
const WORKTREE = '/home/dev/Ensemblr/workspaces/ensemblr/aperghis';

/** Milliseconds per second, so the fixtures' elapsed times read as seconds. */
const SECOND_MS = 1000;

/**
 * Builds one live job without restating the fields every row shares, so a
 * fixture reads as the difference it is demonstrating. Command jobs get a log
 * under the worktree's `.context/compute-queue/`, as main writes them.
 * @param id - Job id, also the log's file name
 * @param overrides - Fields this row needs to differ on
 * @returns A job the panel can render
 */
function job(
	id: string,
	overrides: Partial<ComputeJobSnapshot> = {},
): ComputeJobSnapshot {
	const kind = overrides.kind ?? 'command';
	return {
		command: 'bun run test',
		endedAt: null,
		enqueuedAt: Date.now() - 30 * SECOND_MS,
		exitCode: null,
		id,
		initiator: 'agent',
		kind,
		label: 'bun run test',
		logPath:
			kind === 'command'
				? `${WORKTREE}/.context/compute-queue/${id}.log`
				: null,
		position: null,
		script: null,
		sessionId: null,
		signal: null,
		startedAt: null,
		state: 'queued',
		terminalId: null,
		workspaceId: 'ws-aperghis',
		workspaceName: 'Rework Compute Queue panel',
		...overrides,
	};
}

/**
 * A job that has held a slot for the given number of seconds.
 * @param id - Job id
 * @param seconds - How long ago it was granted its slot
 * @param overrides - Fields this row needs to differ on
 * @returns A running job
 */
function running(
	id: string,
	seconds: number,
	overrides: Partial<ComputeJobSnapshot> = {},
): ComputeJobSnapshot {
	return job(id, {
		startedAt: Date.now() - seconds * SECOND_MS,
		state: 'running',
		...overrides,
	});
}

/**
 * A job waiting at the given place in line.
 * @param id - Job id
 * @param position - One-based place among queued jobs
 * @param overrides - Fields this row needs to differ on
 * @returns A queued job
 */
function queued(
	id: string,
	position: number,
	overrides: Partial<ComputeJobSnapshot> = {},
): ComputeJobSnapshot {
	return job(id, { position, ...overrides });
}

/** The setup script Ensemblr starts on its own when a workspace is created. */
const SETUP_SCRIPT: Partial<ComputeJobSnapshot> = {
	command: 'nix develop -c bun ci',
	initiator: 'auto',
	kind: 'script',
	label: 'nix develop -c bun ci',
	script: { kind: 'setup', name: null },
	workspaceName: 'Aperghis',
};

/** A run script the user clicked, which takes a slot at once. */
const DEV_SERVER: Partial<ComputeJobSnapshot> = {
	command: 'nix develop -c bun run --cwd apps/desktop dev',
	initiator: 'user',
	kind: 'script',
	label: 'nix develop -c bun run --cwd apps/desktop dev',
	script: { kind: 'run', name: 'dev' },
	workspaceName: 'Linear issue sync',
};

/**
 * Wraps jobs in a snapshot, counting slots in use from the running ones the
 * way main does.
 * @param slots - Configured slot count
 * @param jobs - The live jobs
 * @returns A queue snapshot
 */
function queue(
	slots: number,
	jobs: readonly ComputeJobSnapshot[],
): ComputeQueueSnapshot {
	return {
		enabled: true,
		inUse: jobs.filter((entry) => entry.state === 'running').length,
		jobs,
		slots,
	};
}

/** Every queue shape the sidebar panel has to look right in. */
export const COMPUTE_QUEUE_FIXTURES: readonly {
	collapsed: boolean;
	label: string;
	note: string;
	snapshot: ComputeQueueSnapshot;
}[] = [
	{
		collapsed: false,
		label: 'one slot, one command',
		note: 'the default configuration: no slot count in the header, because 1/1 only restates the running row',
		snapshot: queue(1, [
			running('typecheck', 14, {
				command: 'nix develop -c bun run typecheck',
				label: 'bun run typecheck',
			}),
		]),
	},
	{
		collapsed: false,
		label: 'one slot, a line forming',
		note: 'the setup script Ensemblr started on its own, with two agent commands waiting behind it',
		snapshot: queue(1, [
			running('setup', 4, SETUP_SCRIPT),
			queued('vitest', 1, {
				command: 'bunx vitest run tests/renderer/compute-queue-panel.test.tsx',
				label: 'bunx vitest run compute-queue-panel',
			}),
			queued('check', 2, {
				command: 'nix develop -c bun run check',
				label: 'bun run check',
				workspaceName: 'Linear issue sync',
			}),
		]),
	},
	{
		collapsed: false,
		label: 'two slots, busy',
		note: 'slot usage appears once there is more than one slot; long titles and workspace names truncate, the full command is in the title’s tooltip',
		snapshot: queue(2, [
			running('build', 132, {
				command: 'nix develop -c bun run --cwd apps/desktop make:linux',
				label: 'bun run make:linux',
			}),
			running('suite', 48, {
				command:
					'nix develop -c bunx vitest run tests/renderer/workspace-sidebar-item.test.tsx tests/renderer/compute-queue-panel.test.tsx',
				label: 'bunx vitest run workspace-sidebar-item compute-queue-panel',
				workspaceName: 'Refactor the agent-control permission gate',
			}),
			queued('lint', 1, {
				command: 'nix develop -c bun run check',
				label: 'bun run check',
			}),
			queued('setup-2', 2, {
				...SETUP_SCRIPT,
				workspaceName: 'Spinner sync',
			}),
			queued('nix', 3, {
				command: 'nix build .#ensemblr',
				label: 'nix build',
				workspaceName: 'Nix packaging',
			}),
		]),
	},
	{
		collapsed: false,
		label: 'over the limit',
		note: 'a script the user starts takes a slot at once, so usage can read past the configured count — the one case a single slot is worth showing',
		snapshot: queue(1, [
			running('dev', 9, DEV_SERVER),
			running('typecheck-2', 63, {
				command: 'nix develop -c bun run typecheck',
				label: 'bun run typecheck',
			}),
			queued('test', 1, {
				command: 'nix develop -c bun run test',
				label: 'bun run test',
			}),
		]),
	},
	{
		collapsed: true,
		label: 'collapsed',
		note: 'the header alone, carrying the counts the hidden rows would have shown',
		snapshot: queue(2, [
			running('build-2', 132, {
				command: 'nix develop -c bun run --cwd apps/desktop make:linux',
				label: 'bun run make:linux',
			}),
			queued('lint-2', 1, {
				command: 'nix develop -c bun run check',
				label: 'bun run check',
			}),
			queued('nix-2', 2, {
				command: 'nix build .#ensemblr',
				label: 'nix build',
			}),
		]),
	},
];

/** The queue the interactive row starts from, so cancelling has something to remove. */
export const INTERACTIVE_COMPUTE_QUEUE: ComputeQueueSnapshot = queue(2, [
	running('interactive-setup', 6, SETUP_SCRIPT),
	running('interactive-test', 21, {
		command: 'nix develop -c bun run test',
		label: 'bun run test',
	}),
	queued('interactive-check', 1, {
		command: 'nix develop -c bun run check',
		label: 'bun run check',
	}),
	queued('interactive-nix', 2, {
		command: 'nix build .#ensemblr',
		label: 'nix build',
		workspaceName: 'Nix packaging',
	}),
]);
