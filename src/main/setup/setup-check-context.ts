import type {
	SetupCheckLogSnapshot,
	SetupCheckSnapshot,
} from '../../shared/ipc';
import type { LocalCommandResult } from '../commands/local-command';

/** Shared context passed to every setup check provider. */
export interface SetupCheckProviderContext {
	homeDirectory: string;
	now: () => Date;
}

/** Function that produces one {@link SetupCheckSnapshot} for the diagnostics view. */
export type SetupCheckProvider = (
	context: SetupCheckProviderContext,
) => Promise<SetupCheckSnapshot> | SetupCheckSnapshot;

/**
 * Helper that builds a complete {@link SetupCheckSnapshot} from a partial input,
 * defaulting logs, remediation actions and timestamp.
 */
export function createSetupCheckSnapshot(
	check: Omit<SetupCheckSnapshot, 'logs' | 'remediationActions' | 'updatedAt'> &
		Partial<
			Pick<SetupCheckSnapshot, 'logs' | 'remediationActions' | 'updatedAt'>
		>,
): SetupCheckSnapshot {
	return {
		logs: check.logs ?? [],
		remediationActions: check.remediationActions ?? [
			{
				id: `retry-${check.id}`,
				kind: 'retry',
				label: 'Retry check',
			},
		],
		updatedAt: check.updatedAt ?? new Date(0).toISOString(),
		...check,
	};
}

/**
 * Appends `stdout` and `stderr` log entries from a command result, mirroring
 * the truncation flags. Shared between `createCommandLogs` and callers that
 * build their own log prefix (e.g. environment-diagnostics).
 */
export function appendCommandStreamLogs(
	logs: SetupCheckLogSnapshot[],
	result: LocalCommandResult,
): void {
	if (result.logs.stdout) {
		logs.push({
			label: 'stdout',
			text: result.logs.stdout,
			truncated: result.stdoutTruncated,
		});
	}

	if (result.logs.stderr) {
		logs.push({
			label: 'stderr',
			text: result.logs.stderr,
			truncated: result.stderrTruncated,
		});
	}
}

/** Renders a {@link LocalCommandResult} as a setup check log set. */
export function createCommandLogs(
	result: LocalCommandResult,
): SetupCheckLogSnapshot[] {
	const logs: SetupCheckLogSnapshot[] = [
		{
			label: 'Command',
			text: result.logs.command,
		},
	];

	appendCommandStreamLogs(logs, result);

	if (result.failure) {
		logs.push({
			label: result.failure.code,
			text: result.failure.message,
		});
	}

	return logs;
}
