import { spawn } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import path from 'node:path';

import { stripLaunchContextEnv } from '../environment/launch-env.ts';
import {
	type CommandOutput,
	createCommandOutput,
	type OutputTail,
} from './command-output.ts';
import {
	capArgv,
	capCommand,
	describeCapHit,
	planTaskCap,
	type ScopeWatch,
	type TaskCapPlan,
	watchScope,
} from './task-cap.ts';

/**
 * How long a process that has exited is given for its pipes to reach EOF.
 * Whenever the run settles — pipes closed or this grace spent — the job's
 * whole process group is sent SIGKILL, so a backgrounded child, whether or not
 * it still holds the pipes, cannot keep burning CPU after the queue has handed
 * its slot to the next job.
 */
const STREAM_DRAIN_GRACE_MS = 1_000;

/** Shell used when no `bash` is on the merged `PATH`. */
const FALLBACK_SHELL = '/bin/sh';

/** Everything the runner needs to start one granted command job. */
export interface CommandLaunch {
	/** Inherited environment the workspace overlay is merged onto. */
	baseEnv: Record<string, string | undefined>;
	command: string;
	/** Absolute, already-validated working directory. */
	cwd: string;
	jobId: string;
	killGraceMs: number;
	niceness: number;
	/** Workspace overlay assembled for this launch. */
	overlay: Record<string, string>;
	redactValues: readonly string[];
	/** Processes plus threads the job may hold at once; see {@link TaskCapPlan}. */
	taskLimit: number;
	workspacePath: string;
}

/** How a command run ended. */
export interface CommandRunOutcome {
	exitCode: number | null;
	signal: string | null;
	/** True when the job's scope refused a fork and the runner killed it for that. */
	taskCapHit?: boolean;
}

/** A started command the queue can observe and stop. */
export interface CommandRun {
	/** Settles once the process has exited and its output is flushed; never rejects. */
	done: Promise<CommandRunOutcome>;
	/** Sends SIGKILL to the process group, and the job's scope, at once. */
	kill: () => void;
	logPath: string | null;
	/** The cleaned output tail so far. */
	tail: () => OutputTail;
	/** Sends SIGTERM to the process group and scope, then SIGKILL once the grace elapses. */
	terminate: () => void;
}

/** Starts a command job; the queue's seam for a fake runner in tests. */
export type CommandStarter = (launch: CommandLaunch) => CommandRun;

/**
 * Merges the workspace overlay onto the inherited environment the way terminal
 * launches do, stripping launch identity before and after, and turns color off
 * unless the workspace asked for it.
 * @param baseEnv - Inherited environment.
 * @param overlay - Workspace variables and secrets.
 * @returns The child's environment as a clean string record.
 */
export function mergeCommandEnvironment(
	baseEnv: Record<string, string | undefined>,
	overlay: Record<string, string>,
): Record<string, string> {
	const inherited = Object.fromEntries(
		Object.entries(stripLaunchContextEnv(baseEnv)).filter(
			(entry): entry is [string, string] => entry[1] !== undefined,
		),
	);
	const merged = stripLaunchContextEnv({ ...inherited, ...overlay });

	return merged.NO_COLOR === undefined ? { ...merged, NO_COLOR: '1' } : merged;
}

/**
 * Finds an executable by name on a `PATH` string; NixOS has no `/bin/bash`, so
 * the merged environment's own `PATH` is the only reliable place to look.
 * @param name - Executable name.
 * @param searchPath - Colon-separated directories.
 * @returns The absolute path of the first executable match, or null.
 */
export function findExecutable(
	name: string,
	searchPath: string | undefined,
): string | null {
	for (const directory of (searchPath ?? '').split(path.delimiter)) {
		if (!path.isAbsolute(directory)) {
			continue;
		}
		const candidate = path.join(directory, name);
		try {
			accessSync(candidate, constants.X_OK);
			return candidate;
		} catch {}
	}

	return null;
}

/**
 * Builds the argv that runs a command under the resolved shell, lowered in CPU
 * priority with `nice` when a niceness is set and `nice` is available.
 * @param command - Shell command line.
 * @param env - The child's environment, whose `PATH` is searched.
 * @param niceness - Requested niceness; 0 runs at normal priority.
 * @returns The executable and its arguments.
 */
export function buildCommandArgv(
	command: string,
	env: Record<string, string>,
	niceness: number,
): { args: string[]; file: string } {
	const shell = findExecutable('bash', env.PATH) ?? FALLBACK_SHELL;
	const nice = niceness > 0 ? findExecutable('nice', env.PATH) : null;

	return nice === null
		? { args: ['-c', command], file: shell }
		: { args: ['-n', String(niceness), shell, '-c', command], file: nice };
}

/**
 * Signals a whole process group, tolerating one that has already gone.
 * @param pid - Group leader pid, which is also the group id.
 * @param signal - Signal to send.
 */
function signalGroup(pid: number | undefined, signal: NodeJS.Signals): void {
	if (pid === undefined) {
		return;
	}
	try {
		process.kill(-pid, signal);
	} catch {}
}

/**
 * Formats a thrown spawn failure for the output tail.
 * @param error - The error the spawn raised.
 * @returns A one-line description.
 */
function describeSpawnError(error: unknown): string {
	return `Could not start the command: ${error instanceof Error ? error.message : String(error)}`;
}

/** What one spawned job needs to be watched, signalled, and settled. */
interface SpawnedJob {
	/** Signals the job's process group and, when it has one, its scope. */
	signalAll: (signal: NodeJS.Signals) => void;
	outcome: Promise<CommandRunOutcome>;
}

/**
 * Spawns one job under its task-cap plan in its own process group, streaming
 * output and, for a scoped job, killing the scope the moment it refuses a fork.
 * @param launch - The validated launch description.
 * @param env - The job's merged environment.
 * @param plan - How the job is held to its task limit.
 * @param output - The job's log and tail.
 * @returns The way to signal it and its settled outcome, which never rejects.
 */
function spawnCappedJob(
	launch: CommandLaunch,
	env: Record<string, string>,
	plan: TaskCapPlan,
	output: CommandOutput,
): SpawnedJob {
	const argv = capArgv(
		plan,
		buildCommandArgv(capCommand(plan, launch.command), env, launch.niceness),
	);
	let pid: number | undefined;
	let scope: ScopeWatch | null = null;
	let taskCapHit = false;

	/**
	 * Signals everything the job started, through both handles.
	 * @param signal - Signal to send.
	 */
	const signalAll = (signal: NodeJS.Signals): void => {
		signalGroup(pid, signal);
		scope?.signal(signal);
	};

	const outcome = new Promise<CommandRunOutcome>((resolve) => {
		let exit: CommandRunOutcome = { exitCode: null, signal: null };
		let settled = false;

		/** Reaps the group and scope, flushes output, and resolves exactly once. */
		const settle = (): void => {
			if (settled) {
				return;
			}
			settled = true;
			scope?.check();
			signalAll('SIGKILL');
			scope?.stop();
			void output.end().then(() => resolve({ ...exit, taskCapHit }));
		};

		try {
			const child = spawn(argv.file, argv.args, {
				cwd: launch.cwd,
				detached: true,
				env,
				stdio: ['ignore', 'pipe', 'pipe'],
			});
			pid = child.pid;
			if (plan.kind === 'scope' && pid !== undefined) {
				scope = watchScope(pid, plan.unit, () => {
					taskCapHit = true;
					output.note(describeCapHit(plan.limit));
					signalAll('SIGKILL');
				});
			}
			child.stdout?.on('data', (chunk: Buffer) =>
				output.write('stdout', chunk),
			);
			child.stderr?.on('data', (chunk: Buffer) =>
				output.write('stderr', chunk),
			);
			child.on('error', (error) => {
				output.note(describeSpawnError(error));
				settle();
			});
			child.on('exit', (exitCode, signal) => {
				exit = { exitCode, signal };
				setTimeout(() => {
					if (!settled) {
						child.stdout?.destroy();
						child.stderr?.destroy();
						settle();
					}
				}, STREAM_DRAIN_GRACE_MS).unref();
			});
			child.on('close', settle);
		} catch (error) {
			output.note(describeSpawnError(error));
			settle();
		}
	});

	return { outcome, signalAll };
}

/**
 * Starts a granted command job: picks its task cap (a systemd scope where one
 * can be made, a weaker fallback otherwise), then spawns it in its own process
 * group with output streamed to its log and tail. The returned `done` settles
 * after the process exits and its pipes drain (or the drain grace passes), and
 * never rejects. A stop asked for before the spawn means it never spawns.
 * @param launch - The validated launch description.
 * @returns The running command.
 */
export function startCommandProcess(launch: CommandLaunch): CommandRun {
	const output = createCommandOutput({
		jobId: launch.jobId,
		redactValues: launch.redactValues,
		workspacePath: launch.workspacePath,
	});
	const env = mergeCommandEnvironment(launch.baseEnv, launch.overlay);
	const launcher = {
		shell: findExecutable('bash', env.PATH) ?? FALLBACK_SHELL,
		systemdRun: findExecutable('systemd-run', env.PATH),
	};
	let job: SpawnedJob | null = null;
	let stopped = false;
	let killTimer: ReturnType<typeof setTimeout> | null = null;

	const done = planTaskCap(env, launcher, launch.taskLimit, launch.jobId)
		.catch((): TaskCapPlan => ({ kind: 'group' }))
		.then(async (plan): Promise<CommandRunOutcome> => {
			if (stopped) {
				await output.end();
				return { exitCode: null, signal: null };
			}
			job = spawnCappedJob(launch, env, plan, output);
			return job.outcome;
		})
		.finally(() => {
			if (killTimer !== null) {
				clearTimeout(killTimer);
			}
		});

	/**
	 * Signals the spawned job, or keeps it from spawning at all.
	 * @param signal - Signal to send.
	 */
	const signalJob = (signal: NodeJS.Signals): void => {
		stopped = true;
		job?.signalAll(signal);
	};

	return {
		done,
		kill: () => signalJob('SIGKILL'),
		logPath: output.logPath,
		tail: output.tail,
		terminate: () => {
			signalJob('SIGTERM');
			killTimer ??= setTimeout(() => signalJob('SIGKILL'), launch.killGraceMs);
		},
	};
}
