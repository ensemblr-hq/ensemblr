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

	if (result.failure) {
		logs.push({
			label: result.failure.code,
			text: result.failure.message,
		});
	}

	return logs;
}
