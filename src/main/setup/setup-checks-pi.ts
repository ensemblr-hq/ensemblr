import type {
	SetupCheckLogSnapshot,
	SetupRemediationAction,
} from '../../shared/ipc/contracts/setup';
import type { PiExecutableService, PiExecutableSnapshot } from '../pi-runtime';
import { describePiProviderModels } from '../pi-runtime/pi-provider-models.ts';
import type {
	PiAgentDirectorySnapshot,
	PiAgentDirectorySource,
	PiProviderModelSnapshot,
	PiReadinessService,
	PiRpcSmokeSnapshot,
} from '../pi-runtime/pi-readiness';
import {
	authoredDetail,
	commandLog,
	createCommandLogs,
	defineCheck,
	type SetupCheckProviderContext,
	unexpectedErrorDetail,
} from './setup-check-context.ts';

/** Builds the snapshot for the Pi agent-directory readiness check. */
export function getPiAgentDirectoryCheck({
	context,
	piReadinessService,
}: {
	context: SetupCheckProviderContext;
	piReadinessService: PiReadinessService;
}) {
	const check = defineCheck<SetupCheckProviderContext>({
		blocking: true,
		description:
			'Verifies the normal Pi agent directory without redirecting Pi resource discovery.',
		group: 'pi',
		id: 'pi-agent-directory',
		onError: (error) =>
			unexpectedErrorDetail(error, {
				code: 'pi-agent-directory-unknown-error',
				text: 'Unknown Pi agent directory check error.',
			}),
		run: async () => {
			const readiness = await piReadinessService.getSnapshot();
			const agentDirectory = readiness.agentDirectory;
			const status =
				agentDirectory.status === 'success' ? 'success' : 'failure';
			const source = formatPiAgentDirectorySource(agentDirectory.source);

			return {
				...(status === 'success'
					? authoredDetail(
							'pi-agent-directory-ready',
							`Pi agent directory resolves from ${source}: ${agentDirectory.path}.`,
							{ path: agentDirectory.path, source: agentDirectory.source },
						)
					: getPiAgentDirectoryFailureDetail(agentDirectory)),
				logs: createPiAgentDirectoryLogs(agentDirectory),
				remediationActions: [
					{
						id: 'retry-pi-agent-directory',
						kind: 'retry',
						label: 'Retry Pi agent directory check',
					},
				],
				status,
			};
		},
		title: 'Pi agent directory',
	});

	return check(context);
}

/** Builds the snapshot for the Pi RPC startup smoke check. */
export function getPiRpcCheck({
	context,
	piReadinessService,
}: {
	context: SetupCheckProviderContext;
	piReadinessService: PiReadinessService;
}) {
	const check = defineCheck<SetupCheckProviderContext>({
		blocking: true,
		description:
			'Launches the selected Pi executable with --mode rpc from a managed setup smoke workspace.',
		group: 'pi',
		id: 'pi-rpc',
		onError: (error) =>
			unexpectedErrorDetail(error, {
				code: 'pi-rpc-unknown-error',
				text: 'Unknown Pi RPC check error.',
			}),
		run: async () => {
			const readiness = await piReadinessService.getSnapshot();
			const rpc = readiness.rpc;
			const status = rpc.status === 'success' ? 'success' : 'failure';
			const frameType = rpc.firstFrame?.type ?? 'JSONL';

			return {
				...(status === 'success'
					? authoredDetail(
							'pi-rpc-ready',
							`Pi RPC startup produced a valid ${frameType} frame from ${rpc.cwd}.`,
							{ cwd: rpc.cwd, frameType },
						)
					: rpc.failure?.message
						? { detail: rpc.failure.message }
						: authoredDetail(
								'pi-rpc-invalid',
								'Pi RPC startup did not produce valid JSONL.',
							)),
				logs: createPiRpcLogs(rpc),
				remediationActions: [
					{
						id: 'select-pi-executable-for-rpc',
						kind: 'select-path',
						label: 'Select Pi executable',
						target: 'pi.executablePath',
					},
					{
						id: 'retry-pi-rpc',
						kind: 'retry',
						label: 'Retry Pi RPC check',
					},
				],
				status,
			};
		},
		title: 'Pi RPC startup',
	});

	return check(context);
}

/** Builds the snapshot for the Pi provider/model readiness check. */
export function getPiProviderModelCheck({
	context,
	piReadinessService,
}: {
	context: SetupCheckProviderContext;
	piReadinessService: PiReadinessService;
}) {
	const check = defineCheck<SetupCheckProviderContext>({
		blocking: true,
		description:
			'Runs pi --list-models through the selected executable to verify provider/model readiness.',
		group: 'pi',
		id: 'pi-provider-model',
		onError: (error) =>
			unexpectedErrorDetail(error, {
				code: 'pi-models-unknown-error',
				text: 'Unknown Pi provider/model check error.',
			}),
		run: async () => {
			const readiness = await piReadinessService.getSnapshot();
			const providerModels = readiness.providerModels;
			const status =
				providerModels.status === 'success' ? 'success' : 'failure';

			return {
				...describePiProviderModels(providerModels),
				logs: createPiProviderModelLogs(providerModels),
				remediationActions: [
					{
						id: 'open-pi-provider-settings',
						kind: 'open-settings',
						label: 'Open Pi provider settings',
						target: 'pi.providers',
					},
					{
						id: 'retry-pi-provider-model',
						kind: 'retry',
						label: 'Retry provider/model check',
					},
				],
				status,
			};
		},
		title: 'Pi provider and model readiness',
	});

	return check(context);
}

/** Builds the snapshot for the Pi executable discovery check. */
export function getPiExecutableCheck({
	context,
	piExecutableService,
}: {
	context: SetupCheckProviderContext;
	piExecutableService: PiExecutableService;
}) {
	const check = defineCheck<SetupCheckProviderContext>({
		blocking: true,
		description:
			'Discovers a Pi-compatible executable without changing the normal Pi user environment.',
		group: 'pi',
		id: 'pi-executable',
		onError: (error) => ({
			...unexpectedErrorDetail(error, {
				code: 'pi-executable-unknown-error',
				text: 'Unknown Pi executable check error.',
			}),
			remediationActions: [
				{
					id: 'select-pi-executable',
					kind: 'select-path',
					label: 'Select Pi executable',
					target: 'pi.executablePath',
				},
				{
					id: 'retry-pi-executable',
					kind: 'retry',
					label: 'Retry Pi executable check',
				},
			],
		}),
		run: async () => {
			const executable = await piExecutableService.getSnapshot();
			const status =
				executable.status === 'ok'
					? 'success'
					: executable.status === 'warning'
						? 'warning'
						: 'failure';

			return {
				...describePiExecutable(executable, status),
				logs: createPiExecutableLogs(executable),
				remediationActions: createPiExecutableRemediationActions(executable),
				status,
			};
		},
		title: 'Pi executable',
	});

	return check(context);
}

/** Renders the Pi executable resolution as the check's detail line. */
function describePiExecutable(
	executable: PiExecutableSnapshot,
	status: 'failure' | 'success' | 'warning',
) {
	if (status === 'failure') {
		return getPiExecutableFailureDetail(executable.diagnostics);
	}

	if (status === 'warning') {
		return authoredDetail(
			'pi-executable-probe-warning',
			`Pi executable is present at ${executable.displayPath}, but version/help probing needs attention.`,
			{ path: executable.displayPath },
		);
	}

	const source = formatSourceLabel(executable.source);
	const sourceCode = executable.source ?? 'unknown';
	const probe = executable.probe;

	return probe
		? authoredDetail(
				'pi-executable-ready-with-probe',
				`Pi executable selected from ${source}: ${executable.displayPath}. ${probe.kind} probe returned: ${probe.detail}`,
				{
					path: executable.displayPath,
					probeDetail: probe.detail,
					probeKind: probe.kind,
					source: sourceCode,
				},
			)
		: authoredDetail(
				'pi-executable-ready-no-probe',
				`Pi executable selected from ${source}: ${executable.displayPath}. No version/help probe ran.`,
				{ path: executable.displayPath, source: sourceCode },
			);
}

/** Builds the remediation actions surfaced by the Pi executable check. */
function createPiExecutableRemediationActions(
	executable?: PiExecutableSnapshot,
): SetupRemediationAction[] {
	const actions: SetupRemediationAction[] = [];

	if (!executable?.setting?.locked) {
		actions.push({
			id: 'select-pi-executable',
			kind: 'select-path',
			label: 'Select Pi executable',
			target: 'pi.executablePath',
		});
	}

	actions.push({
		id: 'retry-pi-executable',
		kind: 'retry',
		label: 'Retry Pi executable check',
	});

	return actions;
}

/** Renders Pi agent-directory metadata as setup check logs. */
function createPiAgentDirectoryLogs(
	agentDirectory: PiAgentDirectorySnapshot,
): SetupCheckLogSnapshot[] {
	return [
		{
			label: 'Agent directory path',
			labelMessage: { code: 'agent-directory-path' },
			text: agentDirectory.path,
		},
		{
			label: 'Source',
			labelMessage: { code: 'source' },
			text: formatPiAgentDirectorySource(agentDirectory.source),
		},
		...agentDirectory.diagnostics.map((diagnostic) => ({
			label: diagnostic.code,
			text: diagnostic.path
				? `${diagnostic.message} ${diagnostic.path}`
				: diagnostic.message,
		})),
	];
}

/** Renders Pi RPC smoke metadata as setup check logs. */
function createPiRpcLogs(rpc: PiRpcSmokeSnapshot): SetupCheckLogSnapshot[] {
	const logs: SetupCheckLogSnapshot[] = [
		commandLog(rpc.logs.command),
		{
			label: 'cwd',
			text: rpc.logs.cwd,
		},
	];

	if (rpc.firstFrame) {
		logs.push({
			label: 'First JSONL frame',
			labelMessage: { code: 'first-jsonl-frame' },
			text: rpc.firstFrame.type,
		});
	}

	if (rpc.logs.stdout) {
		logs.push({
			label: 'stdout',
			text: rpc.logs.stdout,
			truncated: rpc.stdoutTruncated,
		});
	}

	if (rpc.logs.stderr) {
		logs.push({
			label: 'stderr',
			text: rpc.logs.stderr,
			truncated: rpc.stderrTruncated,
		});
	}

	if (rpc.failure) {
		logs.push({
			label: rpc.failure.code,
			text: rpc.failure.message,
		});
	}

	return logs;
}

/** Renders Pi provider/model metadata as setup check logs. */
function createPiProviderModelLogs(
	providerModels: PiProviderModelSnapshot,
): SetupCheckLogSnapshot[] {
	const resultLogs = providerModels.result
		? createCommandLogs(providerModels.result)
		: [
				commandLog(
					providerModels.command
						? `${providerModels.command} --list-models`
						: '',
				),
			];

	return [
		...resultLogs,
		{
			label: 'Model count',
			labelMessage: { code: 'model-count' },
			text: String(providerModels.modelCount),
		},
		{
			label: 'Provider count',
			labelMessage: { code: 'provider-count' },
			text: String(providerModels.providerCount),
		},
		...(providerModels.failure
			? [
					{
						label: providerModels.failure.code,
						text: providerModels.failure.message,
					},
				]
			: []),
	];
}

/** Renders Pi executable metadata as setup check logs. */
function createPiExecutableLogs(
	executable: PiExecutableSnapshot,
): SetupCheckLogSnapshot[] {
	const logs: SetupCheckLogSnapshot[] = [];

	if (executable.path) {
		logs.push({
			label: 'Executable path',
			labelMessage: { code: 'executable-path' },
			text: executable.path,
		});
	}

	if (executable.source) {
		logs.push({
			label: 'Source',
			labelMessage: { code: 'source' },
			text: formatSourceLabel(executable.source),
		});
	}

	if (executable.probe) {
		logs.push({
			label: `${executable.probe.kind} probe`,
			labelMessage: {
				code: 'pi-probe',
				params: { kind: executable.probe.kind },
			},
			text: executable.probe.detail,
		});
	}

	for (const diagnostic of executable.diagnostics) {
		logs.push({
			label: diagnostic.code,
			text: diagnostic.path
				? `${diagnostic.message} ${diagnostic.path}`
				: diagnostic.message,
		});
	}

	return logs;
}

/** Renders the Pi agent directory source as a human-readable label. */
function formatPiAgentDirectorySource(source: PiAgentDirectorySource): string {
	return source === 'environment'
		? 'PI_CODING_AGENT_DIR'
		: 'Pi default location';
}

/** Picks the headline failure detail for the Pi agent-directory check. */
function getPiAgentDirectoryFailureDetail(
	agentDirectory: PiAgentDirectorySnapshot,
) {
	const diagnostic =
		agentDirectory.diagnostics.find(
			(candidate) => candidate.severity === 'error',
		) ?? agentDirectory.diagnostics.at(-1);

	return diagnostic?.message
		? { detail: diagnostic.message }
		: authoredDetail(
				'pi-agent-directory-unverified',
				'Pi agent directory could not be verified. Fix the Pi environment path or directory permissions, then retry.',
			);
}

/** Renders the Pi executable source as a human-readable label. */
function formatSourceLabel(source: PiExecutableSnapshot['source']): string {
	switch (source) {
		case 'common-location':
			return 'common local binary location';
		case 'config-default':
			return 'declarative config';
		case 'managed-config':
			return 'managed config';
		case 'path':
			return 'shell PATH';
		case 'sqlite':
			return 'user override';
		case 'built-in-default':
			return 'built-in default';
		case 'ensemblr-config':
			return 'Ensemblr repository config';
		default:
			return 'unknown source';
	}
}

/** Picks the headline failure detail for the Pi executable check. */
function getPiExecutableFailureDetail(
	diagnostics: PiExecutableSnapshot['diagnostics'],
) {
	const blockingDiagnostic =
		diagnostics.find((diagnostic) => diagnostic.severity === 'error') ??
		diagnostics.at(-1);

	return blockingDiagnostic?.message
		? { detail: blockingDiagnostic.message }
		: authoredDetail(
				'pi-executable-not-found',
				'Pi executable could not be discovered. Install Pi, select a compatible executable or wrapper, then retry.',
			);
}
