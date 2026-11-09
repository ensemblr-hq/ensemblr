import { execFile } from 'node:child_process';
import { type FSWatcher, readFileSync, watch, writeFileSync } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';

/** How long a failed systemd probe is trusted before the next job asks again. */
const PROBE_FAILURE_TTL_MS = 60_000;

/** Ceiling on the probe itself, so a hung user bus cannot hold a job back. */
const PROBE_TIMEOUT_MS = 5_000;

/** How often the scope's fork-failure counter is re-read as a backstop to its watch. */
const EVENTS_POLL_MS = 250;

/** How often, and how many times, the job's cgroup is looked for after spawn. */
const LOCATE_POLL_MS = 20;
const LOCATE_ATTEMPTS = 250;

/**
 * How one job is held to its task limit, chosen per launch:
 * - `scope` — a transient systemd user scope with `TasksMax`, which caps the
 *   job's processes and threads together and can be killed as one cgroup.
 * - `rlimit` — Linux without a user systemd: a soft `RLIMIT_NPROC` set to the
 *   user's current task count plus the limit. It counts every task the user
 *   owns, not just the job's, so it bounds how far the job can grow rather
 *   than fencing it off.
 * - `group` — the job's own process group and nothing more. macOS lands here:
 *   its `RLIMIT_NPROC` is per user and the kernel already holds it under
 *   `kern.maxprocperuid`, so a per-job headroom on top would never bind.
 */
export type TaskCapPlan =
	| { kind: 'group' }
	| { ceiling: number; kind: 'rlimit' }
	| {
			/** Extra `systemd-run` flags this systemd version needs; see {@link probeSystemdScope}. */
			flags: readonly string[];
			kind: 'scope';
			limit: number;
			systemdRun: string;
			unit: string;
	  };

/**
 * systemd 254 began expanding `$VAR` and `$$` in a `--scope` command line
 * itself, which would rewrite the job's shell command before bash saw it; this
 * turns that off. Versions without the flag do not expand either.
 */
const NO_EXPANSION_FLAG = '--expand-environment=no';

let scopeProbe: {
	expiresAt: number;
	flags: Promise<readonly string[] | null>;
	systemdRun: string;
} | null = null;

/**
 * Runs a no-op in a throwaway capped scope.
 * @param systemdRun - Absolute path of `systemd-run`.
 * @param flags - Extra flags to try it with.
 * @param shell - Shell to run the no-op with.
 * @param env - Environment the job will launch with, which carries the bus address.
 * @returns True when the scope ran.
 */
function runProbeScope(
	systemdRun: string,
	flags: readonly string[],
	shell: string,
	env: Record<string, string>,
): Promise<boolean> {
	return new Promise((resolve) => {
		execFile(
			systemdRun,
			[
				'--user',
				'--scope',
				'--quiet',
				'--collect',
				...flags,
				'-p',
				'TasksMax=16',
				'--',
				shell,
				'-c',
				':',
			],
			{ env, timeout: PROBE_TIMEOUT_MS },
			(error) => resolve(error === null),
		);
	});
}

/**
 * Learns whether `systemd-run --user --scope` works here and which flags it
 * takes, trying {@link NO_EXPANSION_FLAG} first and an older systemd without
 * it second. Success is remembered for the app's lifetime and a failure for a
 * minute, so a session started before the user manager was up recovers.
 * @param systemdRun - Absolute path of `systemd-run`.
 * @param shell - Shell to run the probe's no-op with.
 * @param env - Environment the job will launch with.
 * @returns The flags a scope needs, or null when no capped scope can be made.
 */
function probeSystemdScope(
	systemdRun: string,
	shell: string,
	env: Record<string, string>,
): Promise<readonly string[] | null> {
	if (
		scopeProbe !== null &&
		scopeProbe.systemdRun === systemdRun &&
		Date.now() < scopeProbe.expiresAt
	) {
		return scopeProbe.flags;
	}
	const flags = (async () => {
		for (const candidate of [[NO_EXPANSION_FLAG], []]) {
			if (await runProbeScope(systemdRun, candidate, shell, env)) {
				return candidate;
			}
		}
		return null;
	})();
	const probe = { expiresAt: Number.POSITIVE_INFINITY, flags, systemdRun };
	scopeProbe = probe;
	void flags.then((found) => {
		if (found === null && scopeProbe === probe) {
			scopeProbe = { ...probe, expiresAt: Date.now() + PROBE_FAILURE_TTL_MS };
		}
	});
	return flags;
}

/**
 * Counts the tasks — processes and their threads — the current user owns, the
 * same tally Linux checks `RLIMIT_NPROC` against.
 * @param uid - The user whose tasks to count.
 * @returns The count, or null when `/proc` could not be read.
 */
async function countUserTasks(uid: number): Promise<number | null> {
	try {
		const pids = (await readdir('/proc')).filter((name) => /^\d+$/.test(name));
		const counts = await Promise.all(
			pids.map(async (pid) => {
				try {
					if ((await stat(`/proc/${pid}`)).uid !== uid) {
						return 0;
					}
					return (await readdir(`/proc/${pid}/task`)).length;
				} catch {
					return 0;
				}
			}),
		);
		return counts.reduce((sum, count) => sum + count, 0);
	} catch {
		return null;
	}
}

/**
 * A systemd unit name for a job, kept to the characters unit names allow.
 * @param jobId - The queue's job id.
 * @returns The scope's unit name, without the `.scope` suffix.
 */
function scopeUnitName(jobId: string): string {
	return `ensemblr-job-${jobId.replace(/[^A-Za-z0-9:_.-]/g, '_')}`;
}

/**
 * Chooses the strongest task cap this machine supports for one job; see
 * {@link TaskCapPlan}. Never rejects: anything that fails falls back to the
 * next weaker plan, so a missing systemd never stops a job from running.
 * @param env - The job's merged environment.
 * @param launcher - Where `systemd-run` is and which shell the job runs under.
 * @param limit - Processes plus threads the job may hold at once.
 * @param jobId - The job's id, which names its scope.
 * @returns The plan to launch with.
 */
export async function planTaskCap(
	env: Record<string, string>,
	launcher: { shell: string; systemdRun: string | null },
	limit: number,
	jobId: string,
): Promise<TaskCapPlan> {
	if (process.platform !== 'linux') {
		return { kind: 'group' };
	}
	const { shell, systemdRun } = launcher;
	const flags =
		systemdRun === null
			? null
			: await probeSystemdScope(systemdRun, shell, env);
	if (systemdRun !== null && flags !== null) {
		return {
			flags,
			kind: 'scope',
			limit,
			systemdRun,
			unit: scopeUnitName(jobId),
		};
	}
	const uid = process.getuid?.();
	const owned = uid === undefined ? null : await countUserTasks(uid);
	return owned === null
		? { kind: 'group' }
		: { ceiling: owned + limit, kind: 'rlimit' };
}

/**
 * Applies a plan's shell-side part to the command line: the `rlimit` plan
 * lowers the soft process limit first, and a shell that refuses it runs the
 * command anyway.
 * @param plan - The chosen plan.
 * @param command - The job's shell command line.
 * @returns The command line to hand the shell.
 */
export function capCommand(plan: TaskCapPlan, command: string): string {
	return plan.kind === 'rlimit'
		? `ulimit -S -u ${plan.ceiling} 2>/dev/null\n${command}`
		: command;
}

/**
 * Applies a plan's launcher-side part to the argv: the `scope` plan runs the
 * whole argv under `systemd-run`, which creates the scope and then execs it in
 * place, so the pid and its process group stay the job's.
 * @param plan - The chosen plan.
 * @param argv - The executable and arguments that run the job.
 * @returns The argv to spawn.
 */
export function capArgv(
	plan: TaskCapPlan,
	argv: { args: string[]; file: string },
): { args: string[]; file: string } {
	if (plan.kind !== 'scope') {
		return argv;
	}
	return {
		args: [
			'--user',
			'--scope',
			'--quiet',
			'--collect',
			...plan.flags,
			`--unit=${plan.unit}`,
			'-p',
			`TasksMax=${plan.limit}`,
			'--',
			argv.file,
			...argv.args,
		],
		file: plan.systemdRun,
	};
}

/** A live job scope: whether it hit its cap, and a way to signal everything in it. */
export interface ScopeWatch {
	/** Re-reads the scope's fork-failure counter, reporting a hit if there is one. */
	check: () => void;
	/** Signals every process in the scope; SIGKILL goes through `cgroup.kill`. */
	signal: (signal: NodeJS.Signals) => void;
	/** Stops watching; the scope itself is left to whoever killed it. */
	stop: () => void;
}

/**
 * Finds the cgroup directory a pid lives in once it has moved into its scope.
 * @param pid - The job's pid.
 * @param unit - The scope's unit name.
 * @returns The cgroup directory, or null while the pid is not in the scope yet.
 */
function readScopeDirectory(pid: number, unit: string): string | null {
	try {
		const line = readFileSync(`/proc/${pid}/cgroup`, 'utf8')
			.split('\n')
			.find((entry) => entry.startsWith('0::'));
		const cgroup = line?.slice(3) ?? '';
		return cgroup.endsWith(`/${unit}.scope`)
			? path.join('/sys/fs/cgroup', cgroup)
			: null;
	} catch {
		return null;
	}
}

/**
 * Reads how many forks the scope refused for being over its own limit.
 * `pids.events.local` is preferred because it counts only this cgroup's limit,
 * where `pids.events` on older kernels also counts an ancestor's.
 * @param directory - The scope's cgroup directory.
 * @returns The count, or 0 when the scope is gone.
 */
function readCapHits(directory: string): number {
	for (const file of ['pids.events.local', 'pids.events']) {
		try {
			const match = /^max (\d+)$/m.exec(
				readFileSync(path.join(directory, file), 'utf8'),
			);
			if (match !== null) {
				return Number.parseInt(match[1] ?? '0', 10);
			}
		} catch {}
	}
	return 0;
}

/**
 * Signals each process listed in a cgroup.
 * @param directory - The cgroup directory.
 * @param signal - Signal to send.
 */
function signalCgroupProcesses(
	directory: string,
	signal: NodeJS.Signals,
): void {
	try {
		for (const pid of readFileSync(path.join(directory, 'cgroup.procs'), 'utf8')
			.split('\n')
			.filter(Boolean)) {
			try {
				process.kill(Number.parseInt(pid, 10), signal);
			} catch {}
		}
	} catch {}
}

/**
 * Watches a scoped job's cgroup for a refused fork and gives the runner a way
 * to stop everything in it, including processes that left the job's process
 * group. The cgroup is located by polling `/proc/<pid>/cgroup`, because
 * `systemd-run` moves itself into the scope just before it execs the job.
 * @param pid - The job's pid.
 * @param unit - The scope's unit name.
 * @param onCapHit - Called once, the first time a fork is refused.
 * @returns The watch.
 */
export function watchScope(
	pid: number,
	unit: string,
	onCapHit: () => void,
): ScopeWatch {
	let directory: string | null = null;
	let reported = false;
	let pendingKill = false;
	let attempts = 0;
	let watcher: FSWatcher | null = null;
	let poll: ReturnType<typeof setInterval> | null = null;

	/** Reports the cap hit once the counter moves off zero. */
	const check = (): void => {
		if (!reported && directory !== null && readCapHits(directory) > 0) {
			reported = true;
			onCapHit();
		}
	};

	/**
	 * Signals the scope once its directory is known.
	 * @param signal - Signal to send.
	 */
	const signal = (signal: NodeJS.Signals): void => {
		if (directory === null) {
			pendingKill ||= signal === 'SIGKILL';
			return;
		}
		if (signal !== 'SIGKILL') {
			signalCgroupProcesses(directory, signal);
			return;
		}
		try {
			writeFileSync(path.join(directory, 'cgroup.kill'), '1');
		} catch {
			signalCgroupProcesses(directory, 'SIGKILL');
		}
	};

	/** Starts the event watch and backstop poll on a located scope. */
	const observe = (found: string): void => {
		directory = found;
		try {
			watcher = watch(path.join(found, 'pids.events'), check);
			watcher.on('error', () => undefined);
		} catch {}
		poll = setInterval(check, EVENTS_POLL_MS);
		poll.unref();
		check();
		if (pendingKill) {
			signal('SIGKILL');
		}
	};

	const locate = setInterval(() => {
		attempts += 1;
		const found = readScopeDirectory(pid, unit);
		if (found !== null || attempts >= LOCATE_ATTEMPTS) {
			clearInterval(locate);
		}
		if (found !== null) {
			observe(found);
		}
	}, LOCATE_POLL_MS);
	locate.unref();

	return {
		check,
		signal,
		stop: () => {
			clearInterval(locate);
			if (poll !== null) {
				clearInterval(poll);
			}
			watcher?.close();
		},
	};
}

/**
 * The note a job's output ends with when its scope refused a fork, written for
 * the agent waiting on it: what happened, that nothing survived, and what to do.
 * @param limit - The scope's task limit.
 * @returns The note.
 */
export function describeCapHit(limit: number): string {
	return [
		`Ensemblr stopped this job: it hit its task cap of ${limit} processes and threads (systemd TasksMax), and everything it started was killed.`,
		'Something in the command spawns processes or threads without bound. Find and fix that rather than re-running it unchanged.',
		'The cap is computeQueue.taskLimit in the Ensemblr config; only the user can change it.',
	].join('\n');
}
