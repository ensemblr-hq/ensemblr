import {
	type ChildProcessByStdio,
	spawn as nodeSpawn,
} from 'node:child_process';
import type { Readable, Writable } from 'node:stream';

/** Spawned process surface the adapter depends on, abstracted for tests. */
export type ChildLike = ChildProcessByStdio<Writable, Readable, Readable>;

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

export function buildSpawnEnv(
	overlay: Record<string, string>,
): NodeJS.ProcessEnv {
	return { ...process.env, ...overlay };
}
