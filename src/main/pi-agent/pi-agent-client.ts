import { randomUUID } from 'node:crypto';

import { isExecutableReady } from '../pi/pi-executable.ts';
import type {
	PiAgentAdapter,
	PiAgentAdapterSession,
} from './pi-agent-adapter.ts';
import type {
	PiAgentErrorCode,
	PiAgentEventListener,
	PiAgentModelMetadata,
	PiAgentSessionId,
	PiAgentSessionMetadata,
	PiAgentSessionRequest,
	PiAgentSubmitAcknowledgement,
	PiAgentSubmitRequest,
	PiAgentSubscription,
} from './pi-agent-types.ts';

const PI_AGENT_DIRECTORY_ENV_KEY = 'PI_CODING_AGENT_DIR';
const DEFAULT_PI_RPC_ARGS = ['--mode', 'rpc'] as const;
const DEFAULT_SESSION_LABEL = 'pi-agent-session';

/** Options for the public `createPiAgentClient` factory. */
export interface CreatePiAgentClientOptions {
	adapter: PiAgentAdapter;
	args?: readonly string[];
	now?: () => Date;
	uuid?: () => string;
}

/** Single open Pi agent session exposed to runtime consumers. */
export interface PiAgentSession {
	abort: (reason?: string) => Promise<void>;
	close: () => Promise<void>;
	getMetadata: () => PiAgentSessionMetadata;
	id: PiAgentSessionId;
	subscribe: (listener: PiAgentEventListener) => PiAgentSubscription;
	submit: (
		request: PiAgentSubmitRequest,
	) => Promise<PiAgentSubmitAcknowledgement>;
}

/**
 * Runtime boundary for opening and managing Pi agent sessions. Runtime
 * consumers depend on this interface instead of spawning child processes
 * directly, which keeps the CLI RPC adapter swappable with a future SDK
 * sidecar fallback.
 */
export interface PiAgentClient {
	createSession: (request: PiAgentSessionRequest) => Promise<PiAgentSession>;
	listSessions: () => readonly PiAgentSession[];
	shutdown: () => Promise<void>;
}

/**
 * Raised by the client when a request cannot be honored at the boundary —
 * before reaching the adapter or after the session is closed.
 */
export class PiAgentClientError extends Error {
	readonly code: PiAgentErrorCode;
	readonly detail?: string;
	readonly recoverable: boolean;

	/**
	 * @param input - Code, message, recoverability, and optional detail.
	 */
	constructor(input: {
		code: PiAgentErrorCode;
		detail?: string;
		message: string;
		recoverable: boolean;
	}) {
		super(input.message);
		this.name = 'PiAgentClientError';
		this.code = input.code;
		this.detail = input.detail;
		this.recoverable = input.recoverable;
	}
}

/**
 * Builds a `PiAgentClient` that delegates session lifecycle to the supplied
 * adapter while owning validation, env normalization, metadata seeding, and
 * session registration.
 * @param options - Adapter and overrides for non-deterministic dependencies.
 * @returns A {@link PiAgentClient}.
 */
export function createPiAgentClient({
	adapter,
	args = DEFAULT_PI_RPC_ARGS,
	now = () => new Date(),
	uuid = () => randomUUID(),
}: CreatePiAgentClientOptions): PiAgentClient {
	const sessions = new Map<PiAgentSessionId, PiAgentSession>();

	return {
		createSession: async (request) => {
			validateRequest(request);

			const sessionId = uuid();
			const startedAt = now().toISOString();
			const preservePiAgentDirectory = request.preservePiAgentDirectory ?? true;
			const env = buildEnv({
				overlay: request.env ?? {},
				preservePiAgentDirectory,
			});

			const metadata: PiAgentSessionMetadata = {
				args,
				command: request.executable.command,
				cwd: request.workspaceCwd,
				env,
				id: sessionId,
				label: request.label?.trim() || DEFAULT_SESSION_LABEL,
				model: buildModelMetadata(request.modelOverride),
				piAgentDirectoryPreserved: preservePiAgentDirectory,
				sessionId: null,
				startedAt,
				status: 'starting',
				thinking: null,
				updatedAt: startedAt,
			};

			let adapterSession: PiAgentAdapterSession;
			try {
				adapterSession = await adapter.createSession({ metadata });
			} catch (cause) {
				throw new PiAgentClientError({
					code: 'adapter-failure',
					detail: cause instanceof Error ? cause.message : String(cause),
					message: 'Pi agent adapter failed to open a session.',
					recoverable: true,
				});
			}

			if (adapterSession.id !== sessionId) {
				await adapterSession.close().catch(() => undefined);
				throw new PiAgentClientError({
					code: 'adapter-failure',
					detail: `Adapter returned session id ${adapterSession.id}, expected ${sessionId}.`,
					message: 'Pi agent adapter violated the session id contract.',
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
			await adapter.shutdown();
		},
	};
}

/**
 * Extracts provider attribution from a `modelOverride` string. Recognizes the
 * conventional `provider/model-id` shape (e.g., `openai/gpt-test`); falls back
 * to a synthetic `override` provider when the input is opaque so the metadata
 * can still record the requested id.
 */
function buildModelMetadata(
	modelOverride: string | null | undefined,
): PiAgentModelMetadata | null {
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
 * submits raise a typed `PiAgentClientError` instead of reaching the adapter.
 */
function wrapSession({
	adapterSession,
	onClose,
}: {
	adapterSession: PiAgentAdapterSession;
	onClose: () => void;
}): PiAgentSession {
	let closed = false;

	const ensureOpen = (operation: string): void => {
		if (closed) {
			throw new PiAgentClientError({
				code: 'session-closed',
				message: `Cannot ${operation} on a closed Pi agent session.`,
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
			onClose();
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
		id: adapterSession.id,
		subscribe: (listener) => {
			ensureOpen('subscribe to');
			return adapterSession.subscribe(listener);
		},
		submit: async (request) => {
			ensureOpen('submit');

			if (!request.prompt.trim()) {
				throw new PiAgentClientError({
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
 */
function validateRequest(request: PiAgentSessionRequest): void {
	if (!request.workspaceCwd.trim()) {
		throw new PiAgentClientError({
			code: 'invalid-cwd',
			message: 'Workspace cwd is required to open a Pi agent session.',
			recoverable: false,
		});
	}

	if (!isExecutableReady(request.executable)) {
		throw new PiAgentClientError({
			code: 'invalid-executable',
			message:
				'The selected Pi executable is not ready. Resolve setup checks before opening a session.',
			recoverable: false,
		});
	}
}

/**
 * Normalizes the caller env overlay: drops null/undefined entries, and (when
 * `preservePiAgentDirectory` is true) strips any caller-supplied
 * `PI_CODING_AGENT_DIR` so Ensemble never silently overrides Pi's default
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
