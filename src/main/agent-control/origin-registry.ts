/**
 * In-memory registry of agent-control origins. At agent spawn the app registers
 * a session here, minting a secret token the bridges inject into the agent's
 * environment. Inbound commands carry only that token; the registry resolves it
 * back to the trusted {@link AgentControlOrigin}, so agent-supplied identity is
 * never believed. Lineage (parent + depth) is derived here for the guardrails.
 */
import { randomUUID } from 'node:crypto';

import type { AgentControlOrigin, AgentSpecies } from './ports.ts';

/** Details supplied when registering a freshly spawned agent session. */
export interface RegisterOriginInput {
	sessionId: string;
	workspaceId: string;
	workspaceCwd: string;
	species: AgentSpecies;
	/** Session id of the agent that spawned this one, when any. */
	parentSessionId?: string | null;
}

/** Registry surface used by the bridges (register) and the service (resolve). */
export interface OriginRegistry {
	register: (input: RegisterOriginInput) => AgentControlOrigin;
	resolveByToken: (token: string) => AgentControlOrigin | null;
	resolveBySession: (sessionId: string) => AgentControlOrigin | null;
	release: (sessionId: string) => void;
	/** Session ids from the given session up to the lineage root, exclusive of itself. */
	ancestorsOf: (sessionId: string) => readonly string[];
	/** Session ids of the registered origins spawned directly by the given session. */
	childrenOf: (sessionId: string) => readonly string[];
}

/** Options for {@link createOriginRegistry}; overrides exist for tests. */
interface CreateOriginRegistryOptions {
	generateToken?: () => string;
}

/**
 * Builds an {@link OriginRegistry} backed by two maps (by token, by session).
 * @param options - Optional token generator override for deterministic tests.
 * @returns A registry that mints, resolves, and releases origins.
 */
export function createOriginRegistry(
	options: CreateOriginRegistryOptions = {},
): OriginRegistry {
	const generateToken = options.generateToken ?? (() => randomUUID());
	const byToken = new Map<string, AgentControlOrigin>();
	const bySession = new Map<string, AgentControlOrigin>();

	const resolveDepth = (parentSessionId: string | null): number => {
		if (!parentSessionId) {
			return 0;
		}
		const parent = bySession.get(parentSessionId);
		return parent ? parent.depth + 1 : 0;
	};

	const register = (input: RegisterOriginInput): AgentControlOrigin => {
		const existing = bySession.get(input.sessionId);
		if (existing) {
			return existing;
		}
		const parentSessionId = input.parentSessionId ?? null;
		const origin: AgentControlOrigin = {
			token: generateToken(),
			sessionId: input.sessionId,
			workspaceId: input.workspaceId,
			workspaceCwd: input.workspaceCwd,
			parentSessionId,
			depth: resolveDepth(parentSessionId),
			species: input.species,
		};
		byToken.set(origin.token, origin);
		bySession.set(origin.sessionId, origin);
		return origin;
	};

	const resolveByToken = (token: string): AgentControlOrigin | null =>
		byToken.get(token) ?? null;

	const resolveBySession = (sessionId: string): AgentControlOrigin | null =>
		bySession.get(sessionId) ?? null;

	const release = (sessionId: string): void => {
		const origin = bySession.get(sessionId);
		if (!origin) {
			return;
		}
		bySession.delete(sessionId);
		byToken.delete(origin.token);
	};

	const ancestorsOf = (sessionId: string): readonly string[] => {
		const chain: string[] = [];
		const seen = new Set<string>([sessionId]);
		let current = bySession.get(sessionId)?.parentSessionId ?? null;
		while (current && !seen.has(current)) {
			chain.push(current);
			seen.add(current);
			current = bySession.get(current)?.parentSessionId ?? null;
		}
		return chain;
	};

	const childrenOf = (sessionId: string): readonly string[] => {
		const children: string[] = [];
		for (const origin of bySession.values()) {
			if (origin.parentSessionId === sessionId) {
				children.push(origin.sessionId);
			}
		}
		return children;
	};

	return {
		register,
		resolveByToken,
		resolveBySession,
		release,
		ancestorsOf,
		childrenOf,
	};
}
