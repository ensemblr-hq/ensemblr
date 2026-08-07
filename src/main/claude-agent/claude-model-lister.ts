import { query } from '@anthropic-ai/claude-agent-sdk';

import type { AgentModelOption } from '../../shared/ipc/contracts/agent-models';
import { stripLaunchContextEnv } from '../environment/launch-env.ts';
import { presentClaudeModels } from './claude-model-catalog.ts';
import { createPromptQueue } from './prompt-queue.ts';

/** How long a listed catalog is reused before the runtime is asked again. */
const CATALOG_TTL_MS = 5 * 60 * 1000;

/** Options for {@link createClaudeModelLister}. */
export interface CreateClaudeModelListerOptions {
	/** Resolves the login-shell env, so a Finder-launched app still finds `claude`. */
	resolveBaseEnv?: () => NodeJS.ProcessEnv | Promise<NodeJS.ProcessEnv>;
	/** Resolves the `claude` binary to run; no path means the runtime is unavailable. */
	resolveExecutablePath?: () => string | null | Promise<string | null>;
	/** Injection seam for tests; defaults to the SDK's own `query`. */
	queryFn?: typeof query;
	now?: () => number;
}

/**
 * Builds the merged catalog's Claude half.
 *
 * Listing models means starting a `claude` child, because `supportedModels()` is
 * a method on a live `Query` — the account's entitlements decide the list. The
 * result is cached for {@link CATALOG_TTL_MS} and in-flight calls share one
 * child, so opening the picker repeatedly does not respawn the runtime.
 *
 * With no binary installed the picker simply shows no Claude models; the
 * Providers page is where that is explained. An unavailable runtime is never
 * cached, so installing `claude` takes effect on the next listing.
 * @param options - Env and executable resolution plus test seams.
 * @returns A function returning the Claude catalog, empty when the runtime is unavailable.
 */
export function createClaudeModelLister({
	now = () => Date.now(),
	queryFn = query,
	resolveBaseEnv = () => process.env,
	resolveExecutablePath = () => null,
}: CreateClaudeModelListerOptions = {}): () => Promise<
	readonly AgentModelOption[]
> {
	let cached: { at: number; models: readonly AgentModelOption[] } | null = null;
	let inFlight: Promise<readonly AgentModelOption[]> | null = null;

	const load = async (): Promise<readonly AgentModelOption[] | null> => {
		const [baseEnv, executablePath] = await Promise.all([
			resolveBaseEnv(),
			resolveExecutablePath(),
		]);
		if (!executablePath) {
			return null;
		}
		const promptQueue = createPromptQueue();
		const session = queryFn({
			options: {
				env: stripLaunchContextEnv({ ...baseEnv }),
				pathToClaudeCodeExecutable: executablePath,
				// Nothing is ever prompted, so plan mode keeps the child from being
				// able to touch the workspace while it reports its capabilities.
				permissionMode: 'plan',
			},
			prompt: promptQueue.stream,
		});

		try {
			return presentClaudeModels(await session.supportedModels());
		} finally {
			promptQueue.close();
			session.close();
		}
	};

	return async () => {
		if (cached && now() - cached.at < CATALOG_TTL_MS) {
			return cached.models;
		}
		if (!inFlight) {
			inFlight = load()
				.then((models) => {
					if (!models) {
						return [] as readonly AgentModelOption[];
					}
					cached = { at: now(), models };
					return models;
				})
				.catch(() => [] as readonly AgentModelOption[])
				.finally(() => {
					inFlight = null;
				});
		}
		return inFlight;
	};
}
