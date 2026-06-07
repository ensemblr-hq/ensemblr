import type {
	SetupCheckLogSnapshot,
	SetupCheckSnapshot,
	SetupRemediationAction,
} from '../../shared/ipc';
import type {
	PiExecutableService,
	PiExecutableSnapshot,
} from '../pi/pi-executable';
import type {
	PiAgentDirectorySnapshot,
	PiAgentDirectorySource,
	PiProviderModelSnapshot,
	PiReadinessService,
	PiRpcSmokeSnapshot,
} from '../pi/pi-readiness';
import {
	createCommandLogs,
	createSetupCheckSnapshot,
	type SetupCheckProviderContext,
} from './setup-diagnostics.ts';

/** Builds the snapshot for the Pi agent-directory readiness check. */
export async function getPiAgentDirectoryCheck({
	context,
	piReadinessService,
}: {
	context: SetupCheckProviderContext;
	piReadinessService: PiReadinessService;
}): Promise<SetupCheckSnapshot> {
	try {
		const readiness = await piReadinessService.getSnapshot();
		const agentDirectory = readiness.agentDirectory;
		const status = agentDirectory.status === 'success' ? 'success' : 'failure';
		const detail =
			status === 'success'
				? `Pi agent directory resolves from ${formatPiAgentDirectorySource(
						agentDirectory.source,
					)}: ${agentDirectory.path}.`
				: getPiAgentDirectoryFailureDetail(agentDirectory);

		return createSetupCheckSnapshot({
			blocking: true,
			description:
				'Verifies the normal Pi agent directory without redirecting Pi resource discovery.',
			detail,
			group: 'pi',
			id: 'pi-agent-directory',
			logs: createPiAgentDirectoryLogs(agentDirectory),
			remediationActions: [
				{
					id: 'retry-pi-agent-directory',
					kind: 'retry',
					label: 'Retry Pi agent directory check',
				},
			],
			status,
			title: 'Pi agent directory',
			updatedAt: context.now().toISOString(),
		});
	} catch (error) {
		return createSetupCheckSnapshot({
			blocking: true,
			description:
				'Verifies the normal Pi agent directory without redirecting Pi resource discovery.',
			detail:
				error instanceof Error
					? error.message
					: 'Unknown Pi agent directory check error.',
			group: 'pi',
			id: 'pi-agent-directory',
			logs: [],
			status: 'failure',
			title: 'Pi agent directory',
			updatedAt: context.now().toISOString(),
		});
	}
}

/** Builds the snapshot for the Pi RPC startup smoke check. */
export async function getPiRpcCheck({
	context,
	piReadinessService,
}: {
	context: SetupCheckProviderContext;
	piReadinessService: PiReadinessService;
}): Promise<SetupCheckSnapshot> {
	try {
		const readiness = await piReadinessService.getSnapshot();
		const rpc = readiness.rpc;
		const status = rpc.status === 'success' ? 'success' : 'failure';
		const detail =
			status === 'success'
				? `Pi RPC startup produced a valid ${rpc.firstFrame?.type ?? 'JSONL'} frame from ${rpc.cwd}.`
				: (rpc.failure?.message ??
					'Pi RPC startup did not produce valid JSONL.');

		return createSetupCheckSnapshot({
			blocking: true,
			description:
				'Launches the selected Pi executable with --mode rpc from a managed setup smoke workspace.',
			detail,
			group: 'pi',
			id: 'pi-rpc',
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
			title: 'Pi RPC startup',
			updatedAt: context.now().toISOString(),
		});
	} catch (error) {
		return createSetupCheckSnapshot({
			blocking: true,
			description:
				'Launches the selected Pi executable with --mode rpc from a managed setup smoke workspace.',
			detail:
				error instanceof Error ? error.message : 'Unknown Pi RPC check error.',
			group: 'pi',
			id: 'pi-rpc',
			logs: [],
			status: 'failure',
			title: 'Pi RPC startup',
			updatedAt: context.now().toISOString(),
		});
	}
}

/** Builds the snapshot for the Pi provider/model readiness check. */
export async function getPiProviderModelCheck({
	context,
	piReadinessService,
}: {
	context: SetupCheckProviderContext;
	piReadinessService: PiReadinessService;
}): Promise<SetupCheckSnapshot> {
	try {
		const readiness = await piReadinessService.getSnapshot();
		const providerModels = readiness.providerModels;
		const status = providerModels.status === 'success' ? 'success' : 'failure';
		const detail =
			status === 'success'
				? `Pi listed ${providerModels.modelCount} models across ${providerModels.providerCount} providers.`
				: (providerModels.failure?.message ??
					'Pi provider/model readiness could not be verified.');

		return createSetupCheckSnapshot({
			blocking: true,
			description:
				'Runs pi --list-models through the selected executable to verify provider/model readiness.',
			detail,
			group: 'pi',
			id: 'pi-provider-model',
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
			title: 'Pi provider and model readiness',
			updatedAt: context.now().toISOString(),
		});
	} catch (error) {
		return createSetupCheckSnapshot({
			blocking: true,
			description:
				'Runs pi --list-models through the selected executable to verify provider/model readiness.',
			detail:
				error instanceof Error
					? error.message
					: 'Unknown Pi provider/model check error.',
			group: 'pi',
			id: 'pi-provider-model',
			logs: [],
			status: 'failure',
			title: 'Pi provider and model readiness',
			updatedAt: context.now().toISOString(),
		});
	}
}

/** Builds the snapshot for the Pi executable discovery check. */
export async function getPiExecutableCheck({
	context,
	piExecutableService,
}: {
	context: SetupCheckProviderContext;
	piExecutableService: PiExecutableService;
}): Promise<SetupCheckSnapshot> {
	try {
		const executable = await piExecutableService.getSnapshot();
		const status =
			executable.status === 'ok'
				? 'success'
				: executable.status === 'warning'
					? 'warning'
					: 'failure';
		const detail =
			status === 'success'
				? `Pi executable selected from ${formatSourceLabel(
						executable.source,
					)}: ${executable.displayPath}. ${formatProbeDetail(executable)}`
				: status === 'warning'
					? `Pi executable is present at ${executable.displayPath}, but version/help probing needs attention.`
					: getPiExecutableFailureDetail(executable.diagnostics);

		return createSetupCheckSnapshot({
			blocking: true,
			description:
				'Discovers a Pi-compatible executable without changing the normal Pi user environment.',
			detail,
			group: 'pi',
			id: 'pi-executable',
			logs: createPiExecutableLogs(executable),
			remediationActions: createPiExecutableRemediationActions(executable),
			status,
			title: 'Pi executable',
			updatedAt: context.now().toISOString(),
		});
	} catch (error) {
		return createSetupCheckSnapshot({
			blocking: true,
			description:
				'Discovers a Pi-compatible executable without changing the normal Pi user environment.',
			detail:
				error instanceof Error
					? error.message
					: 'Unknown Pi executable check error.',
			group: 'pi',
			id: 'pi-executable',
			logs: [],
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
			status: 'failure',
			title: 'Pi executable',
			updatedAt: context.now().toISOString(),
		});
	}
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
			text: agentDirectory.path,
		},
		{
			label: 'Source',
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
		{
			label: 'Command',
			text: rpc.logs.command,
		},
		{
			label: 'cwd',
			text: rpc.logs.cwd,
		},
	];

	if (rpc.firstFrame) {
		logs.push({
			label: 'First JSONL frame',
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
				{
					label: 'Command',
					text: providerModels.command
						? `${providerModels.command} --list-models`
						: '',
				},
			];

	return [
		...resultLogs,
		{
			label: 'Model count',
			text: String(providerModels.modelCount),
		},
		{
			label: 'Provider count',
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
	executable: Awaited<ReturnType<PiExecutableService['getSnapshot']>>,
): SetupCheckLogSnapshot[] {
	const logs: SetupCheckLogSnapshot[] = [];

	if (executable.path) {
		logs.push({
			label: 'Executable path',
			text: executable.path,
		});
	}

	if (executable.source) {
		logs.push({
			label: 'Source',
			text: formatSourceLabel(executable.source),
		});
	}

	if (executable.probe) {
		logs.push({
			label: `${executable.probe.kind} probe`,
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
		: 'Pi default ~/.pi/agent';
}

/** Picks the headline failure detail for the Pi agent-directory check. */
function getPiAgentDirectoryFailureDetail(
	agentDirectory: PiAgentDirectorySnapshot,
): string {
	const diagnostic =
		agentDirectory.diagnostics.find(
			(candidate) => candidate.severity === 'error',
		) ?? agentDirectory.diagnostics.at(-1);

	return (
		diagnostic?.message ??
		'Pi agent directory could not be verified. Fix the Pi environment path or directory permissions, then retry.'
	);
}

/** Renders the Pi executable source as a human-readable label. */
function formatSourceLabel(
	source: Awaited<ReturnType<PiExecutableService['getSnapshot']>>['source'],
): string {
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
		case 'conductor-config':
			return 'Conductor config';
		case 'ensemble-config':
			return 'Ensemble repository config';
		default:
			return 'unknown source';
	}
}

/** Renders the Pi executable probe result as a short string. */
function formatProbeDetail(
	executable: Awaited<ReturnType<PiExecutableService['getSnapshot']>>,
): string {
	if (!executable.probe) {
		return 'No version/help probe ran.';
	}

	return `${executable.probe.kind} probe returned: ${executable.probe.detail}`;
}

/** Picks the headline failure detail for the Pi executable check. */
function getPiExecutableFailureDetail(
	diagnostics: Awaited<
		ReturnType<PiExecutableService['getSnapshot']>
	>['diagnostics'],
): string {
	const blockingDiagnostic =
		diagnostics.find((diagnostic) => diagnostic.severity === 'error') ??
		diagnostics.at(-1);

	return (
		blockingDiagnostic?.message ??
		'Pi executable could not be discovered. Install Pi, select a compatible executable or wrapper, then retry.'
	);
}
