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
 * Wraps a PTY stream listener so an exception it throws never travels back into
 * node-pty's native callback.
 * @param listener - Listener supplied by the terminal service
 * @returns The listener, guarded against throwing across the native boundary
 */
function isolateListener<TEvent>(
	listener: (event: TEvent) => void,
): (event: TEvent) => void {
	return (event) => {
		try {
			listener(event);
		} catch (error) {
			// node-pty dispatches exit from a native thread-safe-function callback.
			// node-addon-api rethrows whatever escapes it, and when the JS
			// environment is already tearing down at quit that rethrow fails and
			// aborts the process (SIGABRT) instead of surfacing as an exception.
			console.error('[terminal] pty listener threw', error);
		}
	};
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
				onData: (listener) => pty.onData(isolateListener(listener)),
				onExit: (listener) => pty.onExit(isolateListener(listener)),
				pid: pty.pid,
				resize: (nextCols, nextRows) => pty.resize(nextCols, nextRows),
				write: (data) => pty.write(data),
			};
		},
	};
}
