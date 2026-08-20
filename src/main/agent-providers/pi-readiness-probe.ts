import { getAgentProviderDescriptor } from '../../shared/agent-provider.ts';
import type {
	AgentProviderCheckWire,
	AgentProviderReadinessWire,
} from '../../shared/ipc/contracts/agent-provider';
import type {
	PiAgentDirectorySnapshot,
	PiExecutableSnapshot,
	PiProviderModelSnapshot,
	PiReadinessService,
	PiReadinessSnapshot,
	PiRpcSmokeSnapshot,
} from '../pi-runtime';
import { commandLog } from '../setup/index.ts';
import type { AgentProviderReadinessProbe } from './agent-provider-types.ts';
import {
	authoredDetail,
	toExecutableSource,
	upstreamDetail,
} from './agent-provider-types.ts';

const PI_DESCRIPTOR = getAgentProviderDescriptor('pi');

/** Options for {@link createPiReadinessProbe}. */
export interface CreatePiReadinessProbeOptions {
	piReadinessService: PiReadinessService;
}

/**
 * Adapts Pi's rich readiness snapshot onto the provider-neutral wire shape.
 *
 * This is an adapter, not a rewrite: `PiReadinessService` keeps its own API and
 * its existing consumers (setup diagnostics, the Diagnostics page) untouched.
 * Pi's four probes — executable discovery, the agent directory, the RPC smoke
 * test, and `--list-models` — become four `checks[]` entries.
 * @param options - The Pi readiness service to adapt.
 * @returns The Pi {@link AgentProviderReadinessProbe}.
 */
export function createPiReadinessProbe({
	piReadinessService,
}: CreatePiReadinessProbeOptions): AgentProviderReadinessProbe {
	return {
		probe: async () => {
			const snapshot = await piReadinessService.getSnapshot();
			const checks = [
				createExecutableCheck(snapshot.executable),
				createAgentDirectoryCheck(snapshot.agentDirectory),
				createRpcSmokeCheck(snapshot.rpc),
				createProviderModelCheck(snapshot.providerModels),
			];

			return {
				account: null,
				checks,
				executablePath: snapshot.executable.path || null,
				executableSource: toExecutableSource(snapshot.executable),
				provider: PI_DESCRIPTOR.id,
				status: checks.some((check) => check.status === 'failure')
					? 'failure'
					: 'success',
				updatedAt: snapshot.generatedAt,
				usage: null,
				version: readProbeVersion(snapshot),
			} satisfies AgentProviderReadinessWire;
		},
		provider: PI_DESCRIPTOR.id,
	};
}

/**
 * Builds the check reporting which `pi` binary was discovered. The picker is
 * offered only when the check is not passing and the override is not locked, so
 * a green row carries no action, exactly as the Claude probe's does.
 */
function createExecutableCheck(
	executable: PiExecutableSnapshot,
): AgentProviderCheckWire {
	const status =
		executable.status === 'ok'
			? 'success'
			: executable.status === 'warning'
				? 'warning'
				: 'failure';
	const source = executable.source ?? 'unknown';
	const canPickExecutable = status !== 'success' && !executable.setting?.locked;

	return {
		...(status === 'failure'
			? (upstreamDetail(firstErrorMessage(executable.diagnostics)) ??
				authoredDetail(
					'pi-executable-undiscovered',
					`${PI_DESCRIPTOR.label} could not be discovered. Install it or select a compatible executable.`,
					{ provider: PI_DESCRIPTOR.label },
				))
			: authoredDetail(
					'pi-executable-resolved',
					`${executable.displayPath} (${executable.source ?? 'unknown source'}).`,
					{ path: executable.displayPath, source },
				)),
		id: 'executable',
		label: `${PI_DESCRIPTOR.label} executable`,
		logs: executable.probe
			? [
					{
						label: `${executable.probe.kind} probe`,
						labelMessage: {
							code: 'pi-probe' as const,
							params: { kind: executable.probe.kind },
						},
						text: executable.probe.detail,
					},
				]
			: null,
		remediations: canPickExecutable
			? [
					{
						id: 'select-pi-executable',
						kind: 'select-path' as const,
						label: `Select ${PI_DESCRIPTOR.label} executable`,
						target: PI_DESCRIPTOR.executableSettingKey,
					},
				]
			: [],
		status,
	};
}

/** Builds the check reporting whether Pi's agent directory is usable. */
function createAgentDirectoryCheck(
	agentDirectory: PiAgentDirectorySnapshot,
): AgentProviderCheckWire {
	const failed = agentDirectory.status !== 'success';

	return {
		...(failed
			? (upstreamDetail(firstErrorMessage(agentDirectory.diagnostics)) ??
				authoredDetail(
					'pi-agent-directory-unverified',
					`${PI_DESCRIPTOR.label}'s agent directory could not be verified.`,
					{ provider: PI_DESCRIPTOR.label },
				))
			: authoredDetail(
					'pi-agent-directory-resolved',
					`${agentDirectory.path} (${agentDirectory.source}).`,
					{ path: agentDirectory.path, source: agentDirectory.source },
				)),
		id: 'agent-directory',
		label: 'Agent directory',
		logs: [
			{
				label: 'Agent directory path',
				labelMessage: { code: 'agent-directory-path' },
				text: agentDirectory.path,
			},
			{
				label: 'Source',
				labelMessage: { code: 'source' },
				text: agentDirectory.source,
			},
		],
		remediations: [],
		status: failed ? 'failure' : 'success',
	};
}

/** Builds the check reporting the `pi --mode rpc` startup smoke test. */
function createRpcSmokeCheck(rpc: PiRpcSmokeSnapshot): AgentProviderCheckWire {
	const failed = rpc.status !== 'success';

	const frameType = rpc.firstFrame?.type ?? 'JSONL';

	return {
		...(failed
			? (upstreamDetail(rpc.failure?.message) ??
				authoredDetail(
					'pi-rpc-invalid',
					`${PI_DESCRIPTOR.label} RPC startup did not produce valid JSONL.`,
					{ provider: PI_DESCRIPTOR.label },
				))
			: authoredDetail(
					'pi-rpc-ready',
					`Startup produced a valid ${frameType} frame.`,
					{ frameType },
				)),
		id: 'rpc-smoke',
		label: 'RPC startup',
		logs: [
			commandLog(rpc.logs.command),
			{ label: 'cwd', text: rpc.logs.cwd },
			...(rpc.logs.stdout
				? [
						{
							label: 'stdout',
							text: rpc.logs.stdout,
							truncated: rpc.stdoutTruncated,
						},
					]
				: []),
			...(rpc.logs.stderr
				? [
						{
							label: 'stderr',
							text: rpc.logs.stderr,
							truncated: rpc.stderrTruncated,
						},
					]
				: []),
		],
		remediations: [],
		status: failed ? 'failure' : 'success',
	};
}

/** Builds the check reporting what `pi --list-models` returned. */
function createProviderModelCheck(
	providerModels: PiProviderModelSnapshot,
): AgentProviderCheckWire {
	const failed = providerModels.status !== 'success';

	return {
		...(failed
			? (upstreamDetail(providerModels.failure?.message) ??
				authoredDetail(
					'pi-models-unverified',
					'Provider and model readiness could not be verified.',
				))
			: authoredDetail(
					'pi-models-ready',
					`${providerModels.modelCount} models across ${providerModels.providerCount} providers.`,
					{
						modelCount: providerModels.modelCount,
						providerCount: providerModels.providerCount,
					},
				)),
		id: 'provider-models',
		label: 'Providers and models',
		logs: [
			commandLog(
				providerModels.command ? `${providerModels.command} --list-models` : '',
			),
		],
		remediations: [],
		status: failed ? 'failure' : 'success',
	};
}

/**
 * Reads the version Pi reported during executable discovery. Only a `--version`
 * probe carries one; a `--help` fallback describes usage, not a version.
 * @param snapshot - The Pi readiness snapshot.
 * @returns The reported version line, or `null`.
 */
function readProbeVersion(snapshot: PiReadinessSnapshot): string | null {
	const probe = snapshot.executable.probe;

	return probe?.kind === 'version' && probe.status === 'success'
		? probe.detail
		: null;
}

/** Picks the first `error`-severity diagnostic message, falling back to the last. */
function firstErrorMessage(
	diagnostics: readonly { message: string; severity: string }[],
): string | null {
	const diagnostic =
		diagnostics.find((candidate) => candidate.severity === 'error') ??
		diagnostics.at(-1);

	return diagnostic?.message ?? null;
}
