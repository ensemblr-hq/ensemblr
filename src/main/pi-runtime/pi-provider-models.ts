import {
	type AgentModelCatalog,
	type AgentModelOption,
	asModelVendorId,
	EMPTY_AGENT_MODEL_CATALOG,
} from '../../shared/ipc/contracts/agent-models.ts';
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
	PiProviderModelFailureCode,
	PiProviderModelRow,
	PiProviderModelSnapshot,
} from './pi-runtime-types.ts';

const DEFAULT_THINKING_LEVELS = [
	'off',
	'minimal',
	'low',
	'medium',
	'high',
	'xhigh',
] as const;
const DEFAULT_THINKING_LEVEL = 'medium';

/**
 * Maps a {@link PiProviderModelSnapshot} to the renderer-facing wire shape used
 * by `IPC_CHANNELS.listAgentModels`. Returns the empty result when the snapshot is
 * unsuccessful or empty, so callers can pipe it straight through.
 */
export function presentPiModels(
	input: PiProviderModelSnapshot,
): AgentModelCatalog {
	if (input.status !== 'success' || input.models.length === 0) {
		return EMPTY_AGENT_MODEL_CATALOG;
	}
	const models: AgentModelOption[] = input.models.flatMap((row) =>
		row.model && row.provider
			? [
					{
						agentProvider: 'pi' as const,
						contextWindow: row.contextWindow,
						displayName: row.model,
						id: row.id,
						thinkingLevels: DEFAULT_THINKING_LEVELS,
						vendor: asModelVendorId(row.provider),
					},
				]
			: [],
	);
	if (models.length === 0) {
		return EMPTY_AGENT_MODEL_CATALOG;
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

/** How much a `pi --list-models` size suffix multiplies its number by. */
const TOKEN_MAGNITUDES: Readonly<Record<string, number>> = {
	B: 1_000_000_000,
	K: 1_000,
	M: 1_000_000,
};

/**
 * Smallest bare number the `context` column is believed on. A suffixed cell says
 * what it is; an unsuffixed one is only a token count by position, and the
 * column read is a fixed index into a table whose layout varies by build. A
 * three-figure window does not exist, so anything under this is another column.
 */
const MIN_UNSUFFIXED_TOKENS = 1_000;

/**
 * Reads the `context` column of `pi --list-models` as a token count — `200K`
 * becomes 200000 and `262.1K` becomes 262100. Pi builds that print no such
 * column, and cells too small to be a window, report it as unknown rather than
 * as zero, so the composer can tell "this model has no published window" from
 * "this model has none left".
 * @param cell - The column's raw text, when the row had one.
 * @returns The context window in tokens, or null when the cell names no size.
 */
function parseContextWindowCell(cell: string | undefined): number | null {
	const match = /^(\d+(?:\.\d+)?)([KMB])?$/i.exec(cell?.trim() ?? '');
	const amount = match?.[1];
	if (!amount) {
		return null;
	}
	const suffix = match?.[2]?.toUpperCase();
	const tokens = Math.round(
		Number(amount) * (TOKEN_MAGNITUDES[suffix ?? ''] ?? 1),
	);
	const isPlausibleWindow = suffix
		? tokens > 0
		: tokens >= MIN_UNSUFFIXED_TOKENS;
	return isPlausibleWindow ? tokens : null;
}

/**
 * The `provider  model  context …` header pi prints above its table. Rows are
 * read only after it, because pi answers a machine with no configured provider
 * in prose on the same stream — `No models available. Use /login …` — whose
 * first two words are as good a provider/model pair as any real row, and a
 * model called `No/models` then reaches the picker as something selectable.
 */
const PI_MODEL_TABLE_HEADER = /^provider\s+model\b/i;

/**
 * Parses the columnar `pi --list-models` output into provider/model rows plus
 * deduplicated counts. Anything printed before the table header is prose rather
 * than a row, and is skipped.
 * @param output - Raw stdout (or stderr) from `pi --list-models`.
 * @returns Parsed rows alongside distinct provider and model counts.
 */
export function parsePiListModelsOutput(output: string): {
	modelCount: number;
	models: readonly PiProviderModelRow[];
	providerCount: number;
} {
	const providers = new Set<string>();
	const models: PiProviderModelRow[] = [];
	const seenIds = new Set<string>();
	let isInsideTable = false;

	for (const line of output.split(/\r?\n/)) {
		const trimmedLine = line.trim();

		if (PI_MODEL_TABLE_HEADER.test(trimmedLine)) {
			isInsideTable = true;
			continue;
		}

		if (!isInsideTable || !trimmedLine) {
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
		models.push({
			contextWindow: parseContextWindowCell(columns[2]),
			id,
			model,
			provider,
		});
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
