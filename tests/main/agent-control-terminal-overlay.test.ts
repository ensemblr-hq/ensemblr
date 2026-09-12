import { describe, expect, it } from 'vitest';

import type { WorkspaceEnvironmentService } from '../../src/main/environment/workspace-environment.ts';
import type { EnsemblrDatabaseService } from '../../src/main/storage/database.ts';
import type {
	PtyBackend,
	PtyProcess,
	PtySpawnOptions,
} from '../../src/main/terminal/pty-backend.ts';
import { createTerminalService } from '../../src/main/terminal/terminal-service.ts';
import type { TerminalSessionKind } from '../../src/shared/ipc';

const WORKSPACE_ID = 'ws-1';
const CWD = '/tmp/ws-1';

/** A PTY that records nothing and can be told to exit on demand. */
function createFakePty(): {
	pty: PtyProcess;
	emitExit: () => void;
} {
	const exitListeners = new Set<(event: { exitCode: number }) => void>();
	return {
		emitExit: () => {
			for (const listener of exitListeners) {
				listener({ exitCode: 0 });
			}
		},
		pty: {
			foregroundProcess: () => 'zsh',
			kill: () => {},
			onData: () => ({ dispose: () => {} }),
			onExit: (listener) => {
				exitListeners.add(listener);
				return { dispose: () => exitListeners.delete(listener) };
			},
			pid: 4242,
			resize: () => {},
			write: () => {},
		},
	};
}

/** The workspace layer every terminal starts from, control overlay excluded. */
const workspaceEnvironmentService: WorkspaceEnvironmentService = {
	assemble: async ({ workspaceId }) => ({
		cwd: CWD,
		diagnostics: [],
		env: { ENSEMBLR_WORKSPACE_PATH: CWD },
		port: 41_000,
		redactValues: [],
		workspaceId,
		workspaceName: 'ws-1',
		workspacePath: CWD,
	}),
};

/**
 * Builds the terminal service over fake PTYs and no database, recording the
 * environment each spawn received and every harness-origin release.
 */
const setup = () => {
	const spawned: Array<{ options: PtySpawnOptions; emitExit: () => void }> = [];
	const released: string[] = [];
	const backend: PtyBackend = {
		spawn: (options) => {
			const fake = createFakePty();
			spawned.push({ emitExit: fake.emitExit, options });
			return fake.pty;
		},
	};
	const service = createTerminalService({
		backend,
		databaseService: {
			getConnection: () => null,
		} as unknown as EnsemblrDatabaseService,
		onLifecycle: () => {},
		onOutput: () => {},
		releaseAgentControlOrigins: (workspaceId) => released.push(workspaceId),
		resolveAgentControlEnv: () => ({
			ENSEMBLR_CONTROL_TOKEN: 'tok-1',
			ENSEMBLR_CONTROL_URL: 'http://127.0.0.1:1234',
		}),
		resolveBaseEnv: async () => ({}),
		workspaceEnvironmentService,
	});
	return { released, service, spawned };
};

/** Starts one terminal of the given kind and returns the PTY behind it. */
const start = async (
	service: ReturnType<typeof setup>['service'],
	kind: TerminalSessionKind,
	spawned: ReturnType<typeof setup>['spawned'],
) => {
	await service.create({
		kind,
		...(kind === 'terminal' || kind === 'agent' ? {} : { command: 'echo hi' }),
		workspaceId: WORKSPACE_ID,
	});
	const latest = spawned.at(-1);
	if (!latest) {
		throw new Error('no pty spawned');
	}
	return latest;
};

// `create` is the one entry point for every terminal kind, so the control
// overlay reached the setup, run, and archive scripts too — commands the
// *repository* wrote, handed a live capability into the control channel, with
// `env` printing the token into scrollback persisted under `.context/`.
describe('the agent-control overlay reaches only the terminals that use it', () => {
	it.each(['agent', 'terminal'] as const)(
		'hands a %s session the control token',
		async (kind) => {
			const { service, spawned } = setup();
			const { options } = await start(service, kind, spawned);

			expect(options.env?.ENSEMBLR_CONTROL_TOKEN).toBe('tok-1');
			expect(options.env?.ENSEMBLR_CONTROL_URL).toBe('http://127.0.0.1:1234');
		},
	);

	it.each(['archive-script', 'run-script', 'setup-script'] as const)(
		'withholds it from a %s session',
		async (kind) => {
			const { service, spawned } = setup();
			const { options } = await start(service, kind, spawned);

			expect(options.env?.ENSEMBLR_CONTROL_TOKEN).toBeUndefined();
			expect(options.env?.ENSEMBLR_CONTROL_URL).toBeUndefined();
			expect(options.env?.ENSEMBLR_WORKSPACE_PATH).toBe(CWD);
		},
	);
});

// The `ws:<workspaceId>` origin belongs to no session, so no `releaseSession`
// call reaches it: the token minted for a workspace's first terminal stayed
// valid for the whole run of the app, surviving the workspace's deletion.
describe('a workspace’s harness origin is released with its last terminal', () => {
	it('releases once nothing live is left in the workspace', async () => {
		const { released, service, spawned } = setup();
		const first = await start(service, 'terminal', spawned);
		const second = await start(service, 'terminal', spawned);

		first.emitExit();
		expect(released).toEqual([]);

		second.emitExit();
		expect(released).toEqual([WORKSPACE_ID]);
	});

	it('does not release while another terminal is still running', async () => {
		const { released, service, spawned } = setup();
		const script = await start(service, 'run-script', spawned);
		await start(service, 'terminal', spawned);

		script.emitExit();

		expect(released).toEqual([]);
	});
});

// A control layer that is switched off injects nothing and has nothing to
// release, and the service must not care which.
describe('with no control layer wired', () => {
	it('spawns without the overlay and releases nothing', async () => {
		const spawned: Array<{ options: PtySpawnOptions; emitExit: () => void }> =
			[];
		const service = createTerminalService({
			backend: {
				spawn: (options) => {
					const fake = createFakePty();
					spawned.push({ emitExit: fake.emitExit, options });
					return fake.pty;
				},
			},
			databaseService: {
				getConnection: () => null,
			} as unknown as EnsemblrDatabaseService,
			onLifecycle: () => {},
			onOutput: () => {},
			resolveBaseEnv: async () => ({}),
			workspaceEnvironmentService,
		});

		await service.create({ kind: 'terminal', workspaceId: WORKSPACE_ID });
		const latest = spawned.at(-1);

		expect(latest?.options.env?.ENSEMBLR_CONTROL_TOKEN).toBeUndefined();
		expect(() => latest?.emitExit()).not.toThrow();
	});
});
