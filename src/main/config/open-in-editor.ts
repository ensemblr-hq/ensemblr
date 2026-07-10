import { spawn } from 'node:child_process';

import { shell } from 'electron';

import type { OpenAppConfigFileResult } from '../../shared/ipc/contracts/app-settings.ts';
import { stripLaunchContextEnv } from '../environment/launch-env.ts';

/**
 * Opens a file in the user's preferred editor, in priority order:
 *
 *  1. `$VISUAL` / `$EDITOR` — the user's configured editor command.
 *  2. macOS TextEdit — a guaranteed-present GUI fallback.
 *  3. `shell.openPath` — the OS default file association (last resort, and the
 *     only path on non-macOS platforms when no editor env var is set).
 *
 * Each step is tried only if the previous one failed to launch, so a missing
 * `$EDITOR` binary transparently falls through to TextEdit.
 */
export async function openInEditor(
	filePath: string,
): Promise<OpenAppConfigFileResult> {
	const editor = (process.env.VISUAL ?? process.env.EDITOR ?? '').trim();
	if (editor) {
		const [command, ...args] = editor.split(/\s+/);
		if (command && (await trySpawn(command, [...args, filePath]))) {
			return {};
		}
	}

	if (process.platform === 'darwin') {
		if (await trySpawn('open', ['-a', 'TextEdit', filePath])) {
			return {};
		}
	}

	const error = await shell.openPath(filePath);
	return error ? { error } : {};
}

/**
 * Launches a detached child process and resolves `true` once it has spawned, or
 * `false` if the binary is missing / cannot start. The child is unref'd so it
 * outlives this process and never blocks shutdown.
 */
function trySpawn(command: string, args: string[]): Promise<boolean> {
	return new Promise((resolve) => {
		try {
			const child = spawn(command, args, {
				detached: true,
				// A GUI editor is a LaunchServices context; drop the launch-context
				// vars so it can't make macOS relaunch Ensemble as a second instance.
				env: stripLaunchContextEnv(process.env),
				stdio: 'ignore',
			});
			child.on('error', () => resolve(false));
			child.on('spawn', () => {
				child.unref();
				resolve(true);
			});
		} catch {
			resolve(false);
		}
	});
}
