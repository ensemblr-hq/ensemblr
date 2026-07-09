import {
	type ChildProcessByStdio,
	spawn as nodeSpawn,
} from 'node:child_process';
import type { Readable, Writable } from 'node:stream';

/** Spawned process surface the adapter depends on, abstracted for tests. */
export type ChildLike = ChildProcessByStdio<Writable, Readable, Readable>;

/**
 * Resolves the base environment a Pi child spawns under. Production returns the
 * login-shell environment (correct PATH); the default returns `process.env`.
 */
export type ResolveBaseEnv = () =>
	| NodeJS.ProcessEnv
	| Promise<NodeJS.ProcessEnv>;

/** Factory injected by tests; defaults to `node:child_process.spawn`. */
export type SpawnFn = (input: {
	args: readonly string[];
	command: string;
	cwd: string;
	env: NodeJS.ProcessEnv;
}) => ChildLike;

export function defaultSpawn({
	args,
	command,
	cwd,
	env,
}: {
	args: readonly string[];
	command: string;
	cwd: string;
	env: NodeJS.ProcessEnv;
}): ChildLike {
	return nodeSpawn(command, Array.from(args), {
		cwd,
		env,
		shell: false,
		stdio: ['pipe', 'pipe', 'pipe'],
	}) as ChildLike;
}

/**
 * Merges the resolved base environment with the per-session overlay. The base
 * env is supplied by the caller (production wires the login-shell environment,
 * which carries the user's PATH) rather than read from `process.env` here — a
 * packaged app launched from Finder has a minimal PATH, so pi would resolve by
 * absolute path yet fail its own tool lookups and exit, surfacing later as an
 * EPIPE on the first prompt write.
 * @param baseEnv - Complete base environment to spawn under.
 * @param overlay - Per-session env overrides applied on top of the base.
 * @returns The merged spawn environment.
 */
export function buildSpawnEnv(
	baseEnv: NodeJS.ProcessEnv,
	overlay: Record<string, string>,
): NodeJS.ProcessEnv {
	return { ...baseEnv, ...overlay };
}
