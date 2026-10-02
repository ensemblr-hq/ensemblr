/**
 * Which agent runtime drives a first-class chat: Pi's RPC CLI or Claude Code
 * through the Agent SDK. This is the *runtime* axis and is deliberately distinct
 * from a model's inference provider (`anthropic`, `openai`, …) — a Pi chat can
 * run an Anthropic model, and a Claude chat always does.
 *
 * Terminal harnesses (Codex, Vibe, and the `claude` TUI tab) are not agent
 * providers; they have no chat tab and never reach this axis.
 */
const AGENT_PROVIDER_IDS = ['pi', 'claude'] as const;

/** A single agent runtime selected from {@link AGENT_PROVIDER_IDS}. */
export type AgentProviderId = (typeof AGENT_PROVIDER_IDS)[number];

/** Runtime a session falls back to when none was recorded — every pre-Claude row is Pi's. */
export const DEFAULT_AGENT_PROVIDER: AgentProviderId = 'pi';

/**
 * Everything main and renderer need to know about one agent runtime that is
 * not behaviour: its display name, where its executable override is persisted,
 * what command a PATH lookup probes, and the two user-facing escape hatches
 * (settings file, login command). Descriptors exist so neither process
 * hardcodes per-provider facts in a `switch`.
 *
 * `settingsFile` is stored `~`-relative and is resolved against the real home
 * directory in the main process only — the renderer never expands a home path.
 */
export interface AgentProviderDescriptor {
	/** Bare command a PATH lookup probes for, e.g. `claude`. */
	executableCommand: string;
	/** App-scope `settings` table key holding the user's executable override. */
	executableSettingKey: string;
	id: AgentProviderId;
	label: string;
	/** Command the user runs to authenticate, or `null` when the runtime has no login. */
	loginCommand: string | null;
	/** `~`-relative path to the runtime's own settings file, or `null` when it has none. */
	settingsFile: string | null;
}

const AGENT_PROVIDER_DESCRIPTORS = {
	claude: {
		executableCommand: 'claude',
		executableSettingKey: 'claude.executablePath',
		id: 'claude',
		label: 'Claude Code',
		loginCommand: 'claude /login',
		settingsFile: '~/.claude/settings.json',
	},
	pi: {
		executableCommand: 'pi',
		executableSettingKey: 'pi.executablePath',
		id: 'pi',
		label: 'Pi',
		loginCommand: null,
		settingsFile: null,
	},
} satisfies Record<AgentProviderId, AgentProviderDescriptor>;

/**
 * Type guard narrowing an unknown value to a known agent provider id.
 * @param value - Candidate value to test.
 * @returns True when `value` names a supported agent runtime.
 */
function isAgentProviderId(value: unknown): value is AgentProviderId {
	return (
		typeof value === 'string' &&
		AGENT_PROVIDER_IDS.includes(value as AgentProviderId)
	);
}

/**
 * Coerces an unknown value into a valid agent provider id, falling back to Pi.
 * Used at every boundary that reads a provider off persisted rows or the wire.
 * @param value - Candidate value to normalise.
 * @returns A valid provider id, defaulting to {@link DEFAULT_AGENT_PROVIDER}.
 */
export function normalizeAgentProviderId(value: unknown): AgentProviderId {
	return isAgentProviderId(value) ? value : DEFAULT_AGENT_PROVIDER;
}

/**
 * Human-readable name for an agent runtime, for pickers and settings copy.
 * @param provider - Provider id to label.
 * @returns The display label.
 */
export function getAgentProviderLabel(provider: AgentProviderId): string {
	return AGENT_PROVIDER_DESCRIPTORS[provider].label;
}

/**
 * Static facts about one agent runtime — labels, setting keys, login command.
 * @param provider - Provider id to describe.
 * @returns The provider's {@link AgentProviderDescriptor}.
 */
export function getAgentProviderDescriptor(
	provider: AgentProviderId,
): AgentProviderDescriptor {
	return AGENT_PROVIDER_DESCRIPTORS[provider];
}

/**
 * Every supported agent runtime, in picker order.
 * @returns The provider ids, Pi first.
 */
export function listAgentProviderIds(): readonly AgentProviderId[] {
	return AGENT_PROVIDER_IDS;
}

/**
 * Every provider descriptor, in picker order — the list the Providers page maps
 * over to build one tab per runtime.
 * @returns The descriptors, Pi first.
 */
export function listAgentProviderDescriptors(): readonly AgentProviderDescriptor[] {
	return AGENT_PROVIDER_IDS.map(
		(provider) => AGENT_PROVIDER_DESCRIPTORS[provider],
	);
}
