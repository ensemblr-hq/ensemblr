import type {
	ListPiModelsResult,
	PiModelOptionWire,
} from '../../shared/ipc/contracts/pi-session.ts';
import type {
	LocalCommandFailureCode,
	LocalCommandResult,
	LocalCommandService,
} from '../commands/local-command';
import {
	isExecutableReady,
	type PiExecutableSnapshot,
} from './pi-executable.ts';
import type {
	PiModelOption,
	PiProviderModelFailureCode,
	PiProviderModelSnapshot,
} from './pi-readiness';

const DEFAULT_THINKING_LEVELS = ['low', 'medium', 'high'] as const;
const DEFAULT_THINKING_LEVEL = 'medium';

const EMPTY_PI_MODELS: ListPiModelsResult = {
	defaultModelId: null,
	defaultThinkingLevel: null,
	models: [],
};

/**
 * Maps a {@link PiProviderModelSnapshot} to the renderer-facing wire shape used
 * by `IPC_CHANNELS.listPiModels`. Returns the empty result when the snapshot is
 * unsuccessful or empty, so callers can pipe it straight through.
 */
export function presentPiModels(
	input: PiProviderModelSnapshot,
): ListPiModelsResult {
	if (input.status !== 'success' || input.models.length === 0) {
		return EMPTY_PI_MODELS;
	}
	const models: PiModelOptionWire[] = input.models
		.filter((row) => row.model && row.provider)
		.map((row) => ({
			displayName: `${row.model} (${row.provider})`,
			id: row.id,
			provider: row.provider,
			thinkingLevels: DEFAULT_THINKING_LEVELS,
		}));
	if (models.length === 0) {
		return EMPTY_PI_MODELS;
	}
	return {
		defaultModelId: models[0]?.id ?? null,
		defaultThinkingLevel: DEFAULT_THINKING_LEVEL,
		models,
	};
}

const DEFAULT_PROVIDER_MODEL_TIMEOUT_MS = 10000;
const PROVIDER_MODEL_MAX_OUTPUT_BYTES = 128 * 1024;
const PI_LIST_MODELS_ARGS = ['--list-models'] as const;

/**
 * Runs `pi --list-models` and counts unique providers and models, surfacing
 * failure metadata when the command does not succeed or returns no models.
 * @param input - Executable, command service, and timeout.
 * @returns A {@link PiProviderModelSnapshot}.
 */
export async function resolvePiProviderModels({
	executable,
	localCommandService,
	timeoutMs = DEFAULT_PROVIDER_MODEL_TIMEOUT_MS,
}: {
	executable: PiExecutableSnapshot;
	localCommandService: LocalCommandService;
	timeoutMs?: number;
}): Promise<PiProviderModelSnapshot> {
	if (!isExecutableReady(executable)) {
		return {
			command: executable.command,
			failure: {
				code: 'executable-not-ready',
				message:
					executable.diagnostics.find(
						(diagnostic) => diagnostic.severity === 'error',
					)?.message ??
					'Pi executable is not ready enough to list provider models.',
			},
			modelCount: 0,
			models: [],
			providerCount: 0,
			result: null,
			status: 'failure',
		};
	}

	const result = await localCommandService.run({
		args: PI_LIST_MODELS_ARGS,
		command: executable.command,
		maxOutputBytes: PROVIDER_MODEL_MAX_OUTPUT_BYTES,
		timeoutMs,
	});

	if (result.status !== 'success') {
		return {
			command: executable.command,
			failure: {
				code: mapProviderModelFailureCode(result.failure?.code),
				message: getProviderModelFailureMessage(result),
			},
			modelCount: 0,
			models: [],
			providerCount: 0,
			result,
			status: 'failure',
		};
	}

	// Pi distributions vary in which stream they print the model table on:
	// some write to stdout, others (e.g. the bun-installed
	// @earendil-works/pi-coding-agent wrapper) emit the table on stderr. Try
	// stdout first, fall back to stderr when stdout has no rows.
	const stdoutSummary = parsePiListModelsOutput(result.stdout);
	const modelSummary =
		stdoutSummary.modelCount > 0
			? stdoutSummary
			: parsePiListModelsOutput(result.stderr);

	if (modelSummary.modelCount === 0) {
		return {
			command: executable.command,
			failure: {
				code: 'no-models',
				message:
					'Pi listed zero usable provider models. Configure at least one provider or model, then retry.',
			},
			modelCount: 0,
			models: [],
			providerCount: 0,
			result,
			status: 'failure',
		};
	}

	return {
		command: executable.command,
		modelCount: modelSummary.modelCount,
		models: modelSummary.models,
		providerCount: modelSummary.providerCount,
		result,
		status: 'success',
	};
}

/**
 * Parses the columnar `pi --list-models` output into provider/model rows plus
 * deduplicated counts.
 * @param output - Raw stdout (or stderr) from `pi --list-models`.
 * @returns Parsed rows alongside distinct provider and model counts.
 */
export function parsePiListModelsOutput(output: string): {
	modelCount: number;
	models: readonly PiModelOption[];
	providerCount: number;
} {
	const providers = new Set<string>();
	const models: PiModelOption[] = [];
	const seenIds = new Set<string>();

	for (const line of output.split(/\r?\n/)) {
		const trimmedLine = line.trim();

		if (!trimmedLine || /^provider\s+model\b/i.test(trimmedLine)) {
			continue;
		}

		// Pi table columns may be separated by tabs, multi-spaces, or single
		// spaces — different distributions format differently. Split on any
		// whitespace and accept the first column as the provider name.
		const columns = trimmedLine.split(/\s+/).filter(Boolean);

		if (columns.length < 2) {
			continue;
		}

		const provider = columns[0];
		const model = columns[1];
		if (!provider || !/^[A-Za-z][\w-]*$/.test(provider)) {
			continue;
		}
		if (!model) {
			continue;
		}

		providers.add(provider);

		const id = `${provider}/${model}`;
		if (seenIds.has(id)) {
			continue;
		}
		seenIds.add(id);
		models.push({ id, model, provider });
	}

	return {
		modelCount: models.length,
		models,
		providerCount: providers.size,
	};
}

/** Maps a `pi --list-models` failure to a user-facing message. */
function getProviderModelFailureMessage(result: LocalCommandResult): string {
	switch (result.failure?.code) {
		case 'command-not-found':
			return 'Pi executable was not found while listing provider models.';
		case 'timeout':
			return 'Pi provider/model listing timed out.';
		case 'output-truncated':
			return 'Pi provider/model listing produced too much output.';
		default:
			return `Pi provider/model listing failed: ${
				result.failure?.message ?? 'Unknown command failure.'
			}`;
	}
}

/** Maps the local-command failure code to the matching provider/model code. */
function mapProviderModelFailureCode(
	code: LocalCommandFailureCode | undefined,
): PiProviderModelFailureCode {
	switch (code) {
		case 'command-not-found':
			return 'command-not-found';
		case 'timeout':
			return 'timeout';
		case 'output-truncated':
			return 'output-truncated';
		default:
			return 'nonzero-exit';
	}
}
