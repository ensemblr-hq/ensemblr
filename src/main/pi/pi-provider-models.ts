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
	PiProviderModelSnapshot,
} from './pi-readiness';

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
			providerCount: 0,
			result,
			status: 'failure',
		};
	}

	const modelSummary = parsePiListModelsOutput(result.stdout);

	if (modelSummary.modelCount === 0) {
		return {
			command: executable.command,
			failure: {
				code: 'no-models',
				message:
					'Pi listed zero usable provider models. Configure at least one provider or model, then retry.',
			},
			modelCount: 0,
			providerCount: 0,
			result,
			status: 'failure',
		};
	}

	return {
		command: executable.command,
		modelCount: modelSummary.modelCount,
		providerCount: modelSummary.providerCount,
		result,
		status: 'success',
	};
}

/**
 * Parses the columnar `pi --list-models` output into provider/model counts.
 * @param output - Raw stdout from `pi --list-models`.
 * @returns Distinct provider and model counts.
 */
export function parsePiListModelsOutput(output: string): {
	modelCount: number;
	providerCount: number;
} {
	const providers = new Set<string>();
	let modelCount = 0;

	for (const line of output.split(/\r?\n/)) {
		const trimmedLine = line.trim();

		if (!trimmedLine || /^provider\s+model\b/i.test(trimmedLine)) {
			continue;
		}

		const columns = trimmedLine.split(/\s{2,}/).filter(Boolean);

		if (columns.length < 2) {
			continue;
		}

		providers.add(columns[0]);
		modelCount += 1;
	}

	return {
		modelCount,
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
