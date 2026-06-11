/**
 * Thin adapter boundary over node-pty so the terminal service can be tested
 * with a fake backend and the native module stays an implementation detail.
 *
 * node-pty is imported statically: it is marked external in the main vite
 * config, so the bundle resolves it from node_modules in both the CJS build
 * and dev. (createRequire(import.meta.url) breaks in the CJS main bundle.)
 */

import * as nodePty from 'node-pty';

/** One live pseudo-terminal process. */
export interface PtyProcess {
	kill: (signal?: string) => void;
	onData: (listener: (data: string) => void) => { dispose: () => void };
	onExit: (
		listener: (event: { exitCode: number; signal?: number }) => void,
	) => { dispose: () => void };
	pid: number;
	resize: (cols: number, rows: number) => void;
	write: (data: string) => void;
}

/** Inputs for {@link PtyBackend.spawn}. */
export interface PtySpawnOptions {
	args: string[];
	cols: number;
	cwd: string;
	env: Record<string, string>;
	file: string;
	rows: number;
}

/** Backend capable of spawning pseudo-terminal processes. */
export interface PtyBackend {
	spawn: (options: PtySpawnOptions) => PtyProcess;
}

/**
 * Builds the production backend backed by node-pty.
 * @returns A node-pty backed {@link PtyBackend}.
 */
export function createNodePtyBackend(): PtyBackend {
	return {
		spawn: ({ args, cols, cwd, env, file, rows }) => {
			const pty = nodePty.spawn(file, args, {
				cols,
				cwd,
				env,
				name: 'xterm-256color',
				rows,
				useConpty: false,
			});

			return {
				kill: (signal) => pty.kill(signal),
				onData: (listener) => pty.onData(listener),
				onExit: (listener) => pty.onExit(listener),
				pid: pty.pid,
				resize: (nextCols, nextRows) => pty.resize(nextCols, nextRows),
				write: (data) => pty.write(data),
			};
		},
	};
}
