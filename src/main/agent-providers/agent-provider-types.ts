import type {
	AgentProviderDescriptor,
	AgentProviderId,
} from '../../shared/agent-provider';
import type {
	AgentExecutablePathSnapshotWire,
	AgentExecutableSelectionWire,
	AgentProviderDetailCode,
	AgentProviderDetailMessage,
	AgentProviderExecutableSource,
	AgentProviderReadinessWire,
	ListAgentProviderMcpServersResult,
	ListAgentProviderSlashCommandsResult,
	SetupRemediationWire,
} from '../../shared/ipc/contracts/agent-provider';
import type { ResolvedSettingSnapshot } from '../../shared/ipc/contracts/settings-resolution';
import type { SetupMessageParams } from '../../shared/ipc/contracts/setup';

/**
 * The slice of a resolved executable the provider surface needs: what ran,
 * where it came from, and whether the user configured it. Deliberately narrower
 * than `PiExecutableSnapshot` so every runtime can satisfy it — Pi's richer
 * snapshot is structurally assignable without a converter.
 */
export interface AgentExecutableResolution {
	path: string;
	setting: ResolvedSettingSnapshot | null;
	source: string | null;
	status: 'error' | 'ok' | 'warning';
}

/**
 * Per-runtime executable discovery and override persistence. Pi's existing
 * `PiExecutableService` already implements this shape, which is what lets the
 * parameterized channels treat both runtimes as siblings with no branching.
 */
export interface AgentProviderExecutableService {
	clearOverride: () => AgentExecutableSelectionWire;
	getSnapshot: () => Promise<AgentExecutableResolution>;
	saveOverride: (executablePath: string) => AgentExecutableSelectionWire;
}

/**
 * One runtime's readiness assessment, flattened onto the provider-neutral wire
 * shape the Providers page renders. Each implementation owns its own checks;
 * nothing about Pi's or Claude's internals leaks above this seam.
 */
export interface AgentProviderReadinessProbe {
	probe: () => Promise<AgentProviderReadinessWire>;
	readonly provider: AgentProviderId;
}

/**
 * Provider-parameterized surface behind the agent-provider IPC channels.
 * The handler validates the provider id and does nothing else.
 */
export interface AgentProviderService {
	clearExecutablePath: (
		provider: AgentProviderId,
	) => Promise<AgentExecutablePathSnapshotWire>;
	getExecutablePath: (
		provider: AgentProviderId,
	) => Promise<AgentExecutablePathSnapshotWire>;
	getReadiness: (
		provider: AgentProviderId,
	) => Promise<AgentProviderReadinessWire>;
	listMcpServers: (
		provider: AgentProviderId,
		cwd: string,
	) => Promise<ListAgentProviderMcpServersResult>;
	listSlashCommands: (
		provider: AgentProviderId,
		cwd: string,
	) => Promise<ListAgentProviderSlashCommandsResult>;
	/** Absolute path to the runtime's own settings file, or `null` when it has none. */
	resolveSettingsFilePath: (provider: AgentProviderId) => string | null;
	saveExecutablePath: (
		provider: AgentProviderId,
		executablePath: string,
	) => Promise<AgentExecutablePathSnapshotWire>;
	selectExecutable: (
		provider: AgentProviderId,
		executablePath: string,
	) => AgentExecutableSelectionWire;
}

/** Detail fields for one readiness check, as the wire carries them. */
export type ProviderDetailFields = {
	detail: string;
	detailMessage?: AgentProviderDetailMessage;
};

/**
 * Pairs an authored readiness detail with the code and values the Providers page
 * needs to render it in the app language. The English text stays on the wire
 * because the diagnostics bundle records it verbatim.
 * @param code - Catalogue code for the line.
 * @param text - The English source, already interpolated.
 * @param params - Values the catalogue entry interpolates.
 * @returns The detail fields for an {@link AgentProviderCheckWire}.
 */
export function authoredDetail(
	code: AgentProviderDetailCode,
	text: string,
	params?: SetupMessageParams,
): ProviderDetailFields {
	return {
		detail: text,
		detailMessage: params ? { code, params } : { code },
	};
}

/**
 * Passes an upstream message through as the detail, untranslated — a runtime
 * error or an upstream diagnostic is not ours to reword.
 * @param message - The upstream message, when there is one.
 * @returns The detail fields, or null when the caller should author its own line.
 */
export function upstreamDetail(
	message: string | null | undefined,
): ProviderDetailFields | null {
	return message ? { detail: message } : null;
}

/**
 * The retry action every provider check offers. Shared so both probes emit one
 * remediation shape and only the runtime's own id and label differ.
 * @param descriptor - Runtime whose checks the retry re-runs.
 * @returns A `retry` remediation the Providers page wires to a refetch.
 */
export function createRetryRemediation(
	descriptor: AgentProviderDescriptor,
): SetupRemediationWire {
	return {
		id: `retry-${descriptor.id}-readiness`,
		kind: 'retry',
		label: `Re-run ${descriptor.label} checks`,
	};
}

/**
 * Classifies a resolved executable for the wire. A user-set SQLite/managed/config
 * value is `configured`; anything discovered on disk is `path`; nothing runnable
 * is `missing`, which every runtime treats as an error the user must fix.
 * @param resolution - Resolved executable to classify.
 * @returns The wire-level source category.
 */
export function toExecutableSource(
	resolution: AgentExecutableResolution,
): AgentProviderExecutableSource {
	if (!resolution.path || resolution.status === 'error') {
		return 'missing';
	}

	return resolution.setting ? 'configured' : 'path';
}
