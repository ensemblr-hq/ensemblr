import type {
	SetupCheckGroupId,
	SetupCheckId,
	SetupCheckLogSnapshot,
	SetupCheckSnapshot,
	SetupCheckStatus,
	SetupRemediationAction,
} from '../../shared/ipc/contracts/setup';
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
 * Outcome returned by {@link DefineCheckOptions.run}. The helper merges these
 * fields with the static definition to produce the final {@link SetupCheckSnapshot}.
 */
export interface SetupCheckRunResult {
	blocking?: boolean;
	detail: string;
	logs?: SetupCheckLogSnapshot[];
	remediationActions?: SetupRemediationAction[];
	status: SetupCheckStatus;
}

/**
 * Outcome returned by {@link DefineCheckOptions.onError}. All fields are optional;
 * unspecified fields fall back to the static definition (and a derived `detail`).
 */
export type SetupCheckErrorResult = Partial<SetupCheckRunResult>;

/** Static definition + behaviour for one setup check. */
export interface DefineCheckOptions<TCtx extends SetupCheckProviderContext> {
	blocking: boolean;
	description: string;
	group: SetupCheckGroupId;
	id: SetupCheckId;
	onError?: (error: unknown, context: TCtx) => SetupCheckErrorResult;
	run: (context: TCtx) => Promise<SetupCheckRunResult> | SetupCheckRunResult;
	title: string;
	/** Fallback detail used when `onError` does not supply one. */
	unknownErrorDetail?: string;
}

/**
 * Wraps a check `run` body with shared try/catch handling, snapshot construction
 * and `updatedAt` timestamping. The returned provider eliminates ~50 lines of
 * structural boilerplate per check.
 */
export function defineCheck<TCtx extends SetupCheckProviderContext>(
	definition: DefineCheckOptions<TCtx>,
): (context: TCtx) => Promise<SetupCheckSnapshot> {
	return async (context: TCtx): Promise<SetupCheckSnapshot> => {
		try {
			const result = await definition.run(context);

			return createSetupCheckSnapshot({
				blocking: result.blocking ?? definition.blocking,
				description: definition.description,
				detail: result.detail,
				group: definition.group,
				id: definition.id,
				logs: result.logs ?? [],
				...(result.remediationActions
					? { remediationActions: result.remediationActions }
					: {}),
				status: result.status,
				title: definition.title,
				updatedAt: context.now().toISOString(),
			});
		} catch (error) {
			const fallbackDetail =
				error instanceof Error
					? error.message
					: (definition.unknownErrorDetail ?? 'Unknown check error.');
			const override = definition.onError?.(error, context) ?? {};

			return createSetupCheckSnapshot({
				blocking: override.blocking ?? definition.blocking,
				description: definition.description,
				detail: override.detail ?? fallbackDetail,
				group: definition.group,
				id: definition.id,
				logs: override.logs ?? [],
				...(override.remediationActions
					? { remediationActions: override.remediationActions }
					: {}),
				status: override.status ?? 'failure',
				title: definition.title,
				updatedAt: context.now().toISOString(),
			});
		}
	};
}

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
