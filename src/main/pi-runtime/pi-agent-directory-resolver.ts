import { accessSync, constants, statSync } from 'node:fs';
import { homedir } from 'node:os';

import type { CommandEnvironmentSnapshot } from '../commands/local-command';
import { normalizeConfiguredPath } from './internal/normalize-configured-path.ts';
import type {
	PiAgentDirectorySnapshot,
	PiAgentDirectorySource,
	PiReadinessDiagnostic,
} from './pi-readiness';

const PI_AGENT_DIRECTORY_ENV_KEY = 'PI_CODING_AGENT_DIR';

/**
 * Resolves the Pi agent directory from `PI_CODING_AGENT_DIR` or the default
 * `~/.pi/agent` and verifies it is a readable, writable directory.
 * @param input - Environment snapshot and home directory override.
 * @returns A {@link PiAgentDirectorySnapshot}.
 */
export function resolvePiAgentDirectory({
	environment,
	homeDirectory = homedir(),
}: {
	environment: CommandEnvironmentSnapshot;
	homeDirectory?: string;
}): PiAgentDirectorySnapshot {
	const configuredPath = environment.env[PI_AGENT_DIRECTORY_ENV_KEY]?.trim();
	const source: PiAgentDirectorySource = configuredPath
		? 'environment'
		: 'default';
	const agentDirectoryPath = normalizeConfiguredPath(
		configuredPath || '~/.pi/agent',
		homeDirectory,
	);
	const diagnostics: PiReadinessDiagnostic[] = [];

	try {
		const stats = statSync(agentDirectoryPath);

		if (!stats.isDirectory()) {
			diagnostics.push({
				code: 'pi-agent-directory-not-directory',
				message: 'Pi agent directory path exists but is not a directory.',
				path: agentDirectoryPath,
				severity: 'error',
			});
		}
	} catch {
		diagnostics.push({
			code: 'pi-agent-directory-missing',
			message: 'Pi agent directory does not exist.',
			path: agentDirectoryPath,
			severity: 'error',
		});
	}

	if (diagnostics.length === 0) {
		try {
			accessSync(
				agentDirectoryPath,
				constants.R_OK | constants.W_OK | constants.X_OK,
			);
		} catch (error) {
			diagnostics.push({
				code: 'pi-agent-directory-inaccessible',
				message:
					error instanceof Error
						? error.message
						: 'Pi agent directory is not readable and writable.',
				path: agentDirectoryPath,
				severity: 'error',
			});
		}
	}

	return {
		diagnostics,
		path: agentDirectoryPath,
		source,
		status: diagnostics.some((diagnostic) => diagnostic.severity === 'error')
			? 'failure'
			: 'success',
	};
}
