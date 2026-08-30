import type { AgentProviderId } from '../../shared/agent-provider.ts';
import {
	type AgentModelCatalog,
	type AgentModelOption,
	EMPTY_AGENT_MODEL_CATALOG,
} from '../../shared/ipc/contracts/agent-models.ts';
import type { LocalCommandService } from '../commands/local-command';
import type { PiExecutableService } from '../pi-runtime';
import {
	presentPiModels,
	resolvePiProviderModels,
} from '../pi-runtime/pi-provider-models.ts';

/**
 * How long the model→runtime index is reused before the catalog is rebuilt.
 * Matches the Claude lister's own memo, and exists because listing Pi's models
 * shells out to `pi --list-models`: without it, every chat a user opens would
 * pay that spawn just to learn which runtime owns the selected model.
 */
const PROVIDER_INDEX_TTL_MS = 5 * 60 * 1000;

/**
 * Rung a Claude-defaulted catalog starts on. It is the middle of Claude's own
 * effort ladder and of pi's thinking ladder both, so the same value is right
 * whichever runtime supplies the default.
 */
const FALLBACK_THINKING_LEVEL = 'medium';

/**
 * The level a catalog defaulting to `model` should start on: the shared middle
 * rung when that model publishes it, and its most capable rung otherwise, so a
 * model with a narrower ladder still gets a level it accepts.
 * @param model - The model the catalog defaults to.
 * @returns The default level, or null when the model publishes no ladder.
 */
function pickDefaultThinkingLevel(model: AgentModelOption): string | null {
	return model.thinkingLevels.includes(FALLBACK_THINKING_LEVEL)
		? FALLBACK_THINKING_LEVEL
		: (model.thinkingLevels.at(-1) ?? null);
}

/**
 * Merges the two runtimes' catalogs into the one the picker reads.
 *
 * Pi leads and its defaults win while it has models of its own. A pi install
 * with no configured provider contributes none — and the defaults then name the
 * first Claude model rather than staying null, so a fresh chat opens on a model
 * that can actually run instead of on nothing.
 * @param piModels - Pi's catalog, empty when pi lists no usable model.
 * @param claudeModels - Claude Code's models, most capable first.
 * @returns The merged catalog.
 */
function mergeCatalogs(
	piModels: AgentModelCatalog,
	claudeModels: readonly AgentModelOption[],
): AgentModelCatalog {
	const models = [...piModels.models, ...claudeModels];
	if (piModels.models.length > 0) {
		return { ...piModels, models };
	}
	const fallback = claudeModels[0];
	return {
		defaultModelId: fallback?.id ?? null,
		defaultThinkingLevel: fallback ? pickDefaultThinkingLevel(fallback) : null,
		models,
	};
}

/** Dependencies for {@link createAgentModelCatalog}. */
export interface CreateAgentModelCatalogOptions {
	/**
	 * Lists the Claude Code models this account can run. Absent when the Claude
	 * runtime is not wired up, which leaves the catalog Pi-only rather than empty.
	 */
	listClaudeModels?: () => Promise<readonly AgentModelOption[]>;
	localCommandService: LocalCommandService;
	now?: () => number;
	piExecutableService: PiExecutableService;
}

/**
 * The merged model catalog plus the lookup that turns a selected model id into
 * the agent runtime that can actually drive it.
 */
export interface AgentModelCatalogService {
	/** Every runtime's models, rebuilt on each call so a cold-start poll settles. */
	list: () => Promise<AgentModelCatalog>;
	/**
	 * Which agent runtime owns a model id. `null` when no catalog claims it —
	 * an unrecognised id, or a catalog that could not be read — so callers can
	 * tell "belongs to the other runtime" apart from "nobody knows".
	 */
	resolveAgentProvider: (
		modelId: string | null | undefined,
	) => Promise<AgentProviderId | null>;
}

/**
 * Builds the catalog surface shared by the model-listing channel and the
 * provider pin. Deriving a session's runtime from this catalog in the main
 * process — rather than trusting a `provider` field off the wire — is what
 * stops a stale or hostile renderer from opening a Claude model on Pi.
 * @param options - Per-runtime model sources plus a clock seam for tests.
 * @returns An {@link AgentModelCatalogService}.
 */
export function createAgentModelCatalog({
	listClaudeModels,
	localCommandService,
	now = () => Date.now(),
	piExecutableService,
}: CreateAgentModelCatalogOptions): AgentModelCatalogService {
	let index: {
		at: number;
		providerOf: ReadonlyMap<string, AgentProviderId>;
	} | null = null;

	/** Scrapes Pi's own catalog off `pi --list-models`. */
	const listPiModels = async (): Promise<AgentModelCatalog> => {
		const executable = await piExecutableService.getSnapshot();
		return presentPiModels(
			await resolvePiProviderModels({ executable, localCommandService }),
		);
	};

	const list = async (): Promise<AgentModelCatalog> => {
		const [piModels, claudeModels] = await Promise.all([
			// One runtime being unavailable must not empty the picker for the
			// other, so each catalog degrades to nothing on its own.
			listPiModels().catch(() => EMPTY_AGENT_MODEL_CATALOG),
			Promise.resolve()
				.then(() => listClaudeModels?.() ?? [])
				.catch(() => []),
		]);
		const merged = mergeCatalogs(piModels, claudeModels);
		if (merged.models.length > 0) {
			index = {
				at: now(),
				providerOf: new Map(
					merged.models.map((model) => [model.id, model.agentProvider]),
				),
			};
		}
		return merged;
	};

	const isIndexFresh = (): boolean =>
		index !== null && now() - index.at < PROVIDER_INDEX_TTL_MS;

	return {
		list,
		resolveAgentProvider: async (modelId) => {
			const id = modelId?.trim();
			if (!id) {
				return null;
			}
			if (!isIndexFresh()) {
				try {
					await list();
				} catch (cause) {
					console.warn(
						'[agent-models] could not rebuild the catalog to resolve a provider.',
						{
							cause: cause instanceof Error ? cause.message : String(cause),
							modelId: id,
						},
					);
				}
			}
			return index?.providerOf.get(id) ?? null;
		},
	};
}
