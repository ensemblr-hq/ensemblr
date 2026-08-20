import {
	type AgentProviderId,
	DEFAULT_AGENT_PROVIDER,
	getAgentProviderDescriptor,
} from '../../shared/agent-provider.ts';
import type { AgentAdapter, AgentAdapterSession } from './agent-adapter.ts';
import {
	type AgentErrorCode,
	type AgentEventListener,
	type AgentModelMetadata,
	type AgentSessionId,
	type AgentSessionMetadata,
	type AgentSessionRequest,
	type AgentSessionState,
	type AgentSubmitAcknowledgement,
	type AgentSubmitRequest,
	type AgentSubscription,
	isAgentExecutableReady,
} from './agent-types.ts';

const PI_AGENT_DIRECTORY_ENV_KEY = 'PI_CODING_AGENT_DIR';
const DEFAULT_SESSION_LABEL = 'agent-session';

/**
 * Options for the public `createAgentClient` factory. Pass `adapters` to
 * register one runtime per provider; the single-adapter `adapter` shorthand
 * registers that adapter as the default provider.
 */
export interface CreateAgentClientOptions {
	adapter?: AgentAdapter;
	adapters?: Partial<Record<AgentProviderId, AgentAdapter>>;
	now?: () => Date;
}

/** Single open agent session exposed to runtime consumers. */
export interface AgentSession {
	abort: (reason?: string) => Promise<void>;
	close: () => Promise<void>;
	getMetadata: () => AgentSessionMetadata;
	getState: () => Promise<AgentSessionState>;
	id: AgentSessionId;
	/**
	 * Re-reads the account's plan windows now, resolving false when this runtime
	 * reports none, the session is closed, or the read failed.
	 */
	refreshPlanUsage: () => Promise<boolean>;
	/** Sets the session's display name in the runtime, when it has one. */
	setSessionName: (name: string) => Promise<void>;
	subscribe: (listener: AgentEventListener) => AgentSubscription;
	submit: (request: AgentSubmitRequest) => Promise<AgentSubmitAcknowledgement>;
}

/**
 * Runtime boundary for opening and managing agent sessions. Consumers depend on
 * this interface instead of spawning children or driving SDKs directly, which
 * is what keeps `pi-agent` and `claude-agent` interchangeable behind one seam.
 */
export interface AgentClient {
	createSession: (request: AgentSessionRequest) => Promise<AgentSession>;
	listSessions: () => readonly AgentSession[];
	shutdown: () => Promise<void>;
}

/**
 * Raised by the client when a request cannot be honored at the boundary —
 * before reaching an adapter or after the session is closed.
 */
export class AgentClientError extends Error {
	readonly code: AgentErrorCode;
	readonly detail?: string;
	readonly recoverable: boolean;

	/**
	 * @param input - Code, message, recoverability, and optional detail.
	 */
	constructor(input: {
		code: AgentErrorCode;
		detail?: string;
		message: string;
		recoverable: boolean;
	}) {
		super(input.message);
		this.name = 'AgentClientError';
		this.code = input.code;
		this.detail = input.detail;
		this.recoverable = input.recoverable;
	}
}

/**
 * Builds an `AgentClient` that routes each request to the adapter registered
 * for its provider, while owning validation, env normalization, metadata
 * seeding, and session registration. Runtime-specific argv and SDK options are
 * the adapter's business, so adding a provider never touches this file.
 *
 * Sessions are registered under the caller's `agent_sessions.id` rather than a
 * handle the client mints for itself. A private handle would be a fourth id
 * beside the row key, the runtime session id, and a harness's own id, and every
 * consumer that reached for the wrong one — an approval card, a raw-frame debug
 * filter — failed silently rather than loudly.
 * @param options - Adapters and overrides for non-deterministic dependencies.
 * @returns An {@link AgentClient}.
 */
export function createAgentClient({
	adapter,
	adapters,
	now = () => new Date(),
}: CreateAgentClientOptions): AgentClient {
	const sessions = new Map<AgentSessionId, AgentSession>();
	const registry = buildAdapterRegistry({ adapter, adapters });

	return {
		createSession: async (request) => {
			const provider = request.provider ?? DEFAULT_AGENT_PROVIDER;
			validateRequest(request, provider);

			const providerAdapter = registry.get(provider);
			if (!providerAdapter) {
				throw new AgentClientError({
					code: 'adapter-failure',
					detail: `No adapter is registered for provider "${provider}".`,
					message: 'That agent runtime is not available in this build.',
					recoverable: false,
				});
			}

			const sessionId = request.agentSessionId;
			const startedAt = now().toISOString();
			const preservePiAgentDirectory = request.preservePiAgentDirectory ?? true;
			const env = buildEnv({
				overlay: request.env ?? {},
				preservePiAgentDirectory,
			});

			const metadata: AgentSessionMetadata = {
				args: [],
				command: request.executable?.command ?? '',
				cwd: request.workspaceCwd,
				env,
				id: sessionId,
				label: request.label?.trim() || DEFAULT_SESSION_LABEL,
				model: buildModelMetadata(request.modelOverride),
				piAgentDirectoryPreserved: preservePiAgentDirectory,
				provider,
				sessionId: normalizeNativeSessionId(request.runtimeSessionId),
				startedAt,
				status: 'starting',
				thinking: null,
				updatedAt: startedAt,
			};

			let adapterSession: AgentAdapterSession;
			try {
				adapterSession = await providerAdapter.createSession({
					metadata,
					request,
				});
			} catch (cause) {
				throw new AgentClientError({
					code: 'adapter-failure',
					detail: cause instanceof Error ? cause.message : String(cause),
					message: 'The agent adapter failed to open a session.',
					recoverable: true,
				});
			}

			if (adapterSession.id !== sessionId) {
				await adapterSession.close().catch(() => undefined);
				throw new AgentClientError({
					code: 'adapter-failure',
					detail: `Adapter returned session id ${adapterSession.id}, expected ${sessionId}.`,
					message: 'The agent adapter violated the session id contract.',
					recoverable: false,
				});
			}

			const session = wrapSession({
				adapterSession,
				onClose: () => sessions.delete(sessionId),
			});

			sessions.set(sessionId, session);

			return session;
		},
		listSessions: () => [...sessions.values()],
		shutdown: async () => {
			const open = [...sessions.values()];
			sessions.clear();
			await Promise.all(open.map((session) => session.close()));
			await Promise.all(
				[...new Set(registry.values())].map((registered) =>
					registered.shutdown(),
				),
			);
		},
	};
}

/**
 * Resolves the provider→adapter table from either option form, so the
 * single-adapter shorthand and the multi-provider map share one lookup.
 * @param options - The `adapter` shorthand and/or the explicit `adapters` map.
 * @returns Adapters keyed by provider id.
 */
function buildAdapterRegistry({
	adapter,
	adapters,
}: {
	adapter?: AgentAdapter;
	adapters?: Partial<Record<AgentProviderId, AgentAdapter>>;
}): ReadonlyMap<AgentProviderId, AgentAdapter> {
	const registry = new Map<AgentProviderId, AgentAdapter>();
	if (adapter) {
		registry.set(DEFAULT_AGENT_PROVIDER, adapter);
	}
	for (const [provider, registered] of Object.entries(adapters ?? {})) {
		if (registered) {
			registry.set(provider as AgentProviderId, registered);
		}
	}
	return registry;
}

/** Trims blank native runtime session ids to `null` before metadata is seeded. */
function normalizeNativeSessionId(
	value: string | null | undefined,
): string | null {
	const trimmed = value?.trim();
	return trimmed ? trimmed : null;
}

/**
 * Extracts provider attribution from a `modelOverride` string. Recognizes the
 * conventional `provider/model-id` shape (e.g., `openai/gpt-test`); falls back
 * to a synthetic `override` provider when the input is opaque so the metadata
 * can still record the requested id.
 */
function buildModelMetadata(
	modelOverride: string | null | undefined,
): AgentModelMetadata | null {
	if (!modelOverride) {
		return null;
	}

	const trimmed = modelOverride.trim();
	if (!trimmed) {
		return null;
	}

	const separator = trimmed.indexOf('/');
	if (separator > 0 && separator < trimmed.length - 1) {
		return {
			id: trimmed.slice(separator + 1),
			provider: trimmed.slice(0, separator),
		};
	}

	return { id: trimmed, provider: 'override' };
}

/**
 * Wraps an adapter session so close/abort become idempotent and post-close
 * submits raise a typed `AgentClientError` instead of reaching the adapter.
 */
function wrapSession({
	adapterSession,
	onClose,
}: {
	adapterSession: AgentAdapterSession;
	onClose: () => void;
}): AgentSession {
	let closed = false;
	let removed = false;
	let shutdownSubscription: AgentSubscription | null = null;

	const remove = (): void => {
		if (removed) {
			return;
		}
		removed = true;
		shutdownSubscription?.unsubscribe();
		onClose();
	};

	// A crash exits the child on its own. Without observing the adapter's
	// `shutdown` event the wrapper would never flip `closed`, leaving a dead
	// session in the client map and letting post-crash `submit`/`subscribe` calls
	// throw an untyped adapter error instead of a typed `session-closed` one.
	shutdownSubscription = adapterSession.subscribe((event) => {
		if (event.type === 'shutdown') {
			closed = true;
			remove();
		}
	});
	// A synchronous `shutdown` during `subscribe` would run `remove()` before the
	// assignment above, so `unsubscribe()` there is a no-op; drop the now-stale
	// subscription once we actually hold the handle.
	if (removed) {
		shutdownSubscription.unsubscribe();
	}

	const ensureOpen = (operation: string): void => {
		if (closed) {
			throw new AgentClientError({
				code: 'session-closed',
				message: `Cannot ${operation} on a closed agent session.`,
				recoverable: false,
			});
		}
	};

	const finalize = async (op: () => Promise<void>): Promise<void> => {
		if (closed) {
			return;
		}
		closed = true;
		try {
			await op();
		} finally {
			remove();
		}
	};

	return {
		abort: (reason) =>
			finalize(async () => {
				await adapterSession.abort(reason);
			}),
		close: () =>
			finalize(async () => {
				await adapterSession.close();
			}),
		getMetadata: () => adapterSession.getMetadata(),
		getState: () => {
			ensureOpen('get state from');
			return adapterSession.getState();
		},
		id: adapterSession.id,
		refreshPlanUsage: async () => {
			if (closed || !adapterSession.refreshPlanUsage) {
				return false;
			}
			return adapterSession.refreshPlanUsage();
		},
		setSessionName: (name) => {
			ensureOpen('set session name on');
			return adapterSession.setSessionName(name);
		},
		subscribe: (listener) => {
			ensureOpen('subscribe to');
			return adapterSession.subscribe(listener);
		},
		submit: async (request) => {
			ensureOpen('submit');

			if (!request.prompt.trim()) {
				throw new AgentClientError({
					code: 'submit-failed',
					message: 'Prompt must not be empty.',
					recoverable: true,
				});
			}

			return adapterSession.submit(request);
		},
	};
}

/**
 * Validates inputs before any adapter work happens. Surface errors stay typed
 * so callers can render them in the renderer without leaking adapter detail.
 *
 * An absent executable states no opinion — Pi rejects it because the IPC layer
 * already gated the session on its snapshot, while another runtime keeps
 * whatever binary its adapter would pick. An executable that is *present but
 * unready* is positive knowledge that nothing runnable was found, and is
 * rejected for every provider.
 */
function validateRequest(
	request: AgentSessionRequest,
	provider: AgentProviderId,
): void {
	if (!request.workspaceCwd.trim()) {
		throw new AgentClientError({
			code: 'invalid-cwd',
			message: 'Workspace cwd is required to open an agent session.',
			recoverable: false,
		});
	}

	if (!request.executable) {
		if (provider === DEFAULT_AGENT_PROVIDER) {
			throw new AgentClientError({
				code: 'invalid-executable',
				message: describeUnreadyExecutable(DEFAULT_AGENT_PROVIDER),
				recoverable: false,
			});
		}
		return;
	}

	if (!isAgentExecutableReady(request.executable)) {
		throw new AgentClientError({
			code: 'invalid-executable',
			message: describeUnreadyExecutable(provider),
			recoverable: false,
		});
	}
}

/**
 * Renders the message a user sees when a runtime has no binary to launch. Names
 * the runtime and the command so the error is actionable without the renderer
 * having to know which provider failed.
 * @param provider - Runtime whose executable could not be resolved.
 * @returns A one-line, user-facing explanation pointing at Settings → Providers.
 */
function describeUnreadyExecutable(provider: AgentProviderId): string {
	const { executableCommand, label } = getAgentProviderDescriptor(provider);

	return `No runnable ${label} executable (\`${executableCommand}\`) was found. Install it and resolve the checks in Settings → Providers before opening a session.`;
}

/**
 * Normalizes the caller env overlay: drops null/undefined entries, and (when
 * `preservePiAgentDirectory` is true) strips any caller-supplied
 * `PI_CODING_AGENT_DIR` so Ensemblr never silently overrides Pi's default
 * agent-directory lookup (see ADR 0003).
 */
function buildEnv({
	overlay,
	preservePiAgentDirectory,
}: {
	overlay: Record<string, string | null | undefined>;
	preservePiAgentDirectory: boolean;
}): Record<string, string> {
	const env: Record<string, string> = {};

	for (const [key, value] of Object.entries(overlay)) {
		if (value === null || value === undefined) {
			continue;
		}

		if (preservePiAgentDirectory && key === PI_AGENT_DIRECTORY_ENV_KEY) {
			continue;
		}

		env[key] = value;
	}

	return env;
}
