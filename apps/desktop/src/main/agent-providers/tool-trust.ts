import type { ReportToolInventoryArgs } from '../../shared/agent-control.ts';
import type { AgentProviderId } from '../../shared/agent-provider.ts';
import type { ProviderSettings } from '../../shared/config.ts';
import type {
	AgentProviderToolWire,
	ListAgentProviderToolsResult,
} from '../../shared/ipc/contracts/agent-provider.ts';
import { acceptsUserTrust, toTrustedToolSet } from '../../shared/plan-mode.ts';

/** One tool as a runtime's session reports it. */
export type ReportedTool = ReportToolInventoryArgs['tools'][number];

/**
 * The per-runtime answer to "which extra tools may Plan Mode and the Concierge
 * call": the user's saved list, read live, plus the inventory the Settings list
 * offers them from.
 */
export interface ToolTrustService {
	/** The tools the user vouches for on one runtime, read at call time. */
	trustedTools: (provider: AgentProviderId) => ReadonlySet<string>;
	/** Merges one session's tool list into what that runtime has reported. */
	recordInventory: (
		provider: AgentProviderId,
		tools: readonly ReportedTool[],
	) => void;
	/** Notes that a guard refused a tool the user could have vouched for. */
	recordRefusal: (provider: AgentProviderId, tool: string) => void;
	/** Lists the tools one runtime reported that a user could vouch for. */
	listTools: (provider: AgentProviderId) => ListAgentProviderToolsResult;
}

/** Where each runtime's list lives under the `providers` settings section. */
const SAVED_LIST_KEY = {
	claude: 'claudeReadOnlyTools',
	pi: 'piReadOnlyTools',
} as const satisfies Record<AgentProviderId, keyof ProviderSettings>;

/**
 * Most tools one runtime's inventory holds. A runtime reports its whole tool
 * list per session, so a misbehaving extension that registered names without
 * end would otherwise grow this for the life of the process.
 */
const MAX_INVENTORY_TOOLS = 1000;

/** Most refused names one runtime keeps, for the same reason. */
const MAX_REFUSED_TOOLS = 200;

/** Longest description kept, since the Settings list shows it as one line. */
const MAX_DESCRIPTION_LENGTH = 300;

/** What the inventory keeps per tool. */
interface InventoryEntry {
	description: string | null;
	source: string | null;
}

/**
 * Cuts a description to its first line and a length the Settings row can show.
 * @param description - The description as the runtime reported it.
 * @returns The trimmed first line, or null when there is nothing to show.
 */
function toDisplayDescription(description: string | null): string | null {
	const firstLine = description?.split('\n', 1)[0]?.trim() ?? '';
	if (firstLine.length === 0) {
		return null;
	}
	return firstLine.length > MAX_DESCRIPTION_LENGTH
		? `${firstLine.slice(0, MAX_DESCRIPTION_LENGTH - 1)}…`
		: firstLine;
}

/**
 * Builds the tool-trust service.
 *
 * The inventory lives in memory on purpose. What a runtime holds changes when
 * the user installs or removes an extension or an MCP server, so a persisted
 * list would keep offering tools that no longer exist; a fresh one is rebuilt
 * from the first session each runtime opens. The saved list, by contrast, is
 * read from app settings on every call, so a change in Settings reaches the
 * next tool call rather than the next session.
 * @param readProviderSettings - Reads the `providers` section of app settings.
 * @returns The service.
 */
export function createToolTrustService(
	readProviderSettings: () => ProviderSettings,
): ToolTrustService {
	const inventories = new Map<AgentProviderId, Map<string, InventoryEntry>>();
	const refusals = new Map<AgentProviderId, Set<string>>();

	/**
	 * Returns one runtime's inventory, creating it on first report.
	 * @param provider - The runtime.
	 * @returns Its mutable inventory map.
	 */
	const inventoryOf = (
		provider: AgentProviderId,
	): Map<string, InventoryEntry> => {
		const existing = inventories.get(provider);
		if (existing) {
			return existing;
		}
		const created = new Map<string, InventoryEntry>();
		inventories.set(provider, created);
		return created;
	};

	/**
	 * Returns one runtime's refused names, creating the set on first refusal.
	 * @param provider - The runtime.
	 * @returns Its mutable refusal set.
	 */
	const refusalsOf = (provider: AgentProviderId): Set<string> => {
		const existing = refusals.get(provider);
		if (existing) {
			return existing;
		}
		const created = new Set<string>();
		refusals.set(provider, created);
		return created;
	};

	return {
		/** Reads the saved list for the runtime, stripped of names no trust clears. */
		trustedTools: (provider) =>
			toTrustedToolSet(
				readProviderSettings()[SAVED_LIST_KEY[provider]],
				provider,
			),
		/** Keeps only the names a user could vouch for; the rest need no offer. */
		recordInventory: (provider, tools) => {
			const inventory = inventoryOf(provider);
			for (const tool of tools) {
				const name = tool.name.trim();
				const full = inventory.size >= MAX_INVENTORY_TOOLS;
				if (
					!acceptsUserTrust(name, provider) ||
					(full && !inventory.has(name))
				) {
					continue;
				}
				inventory.set(name, {
					description: toDisplayDescription(tool.description),
					source: tool.source,
				});
			}
		},
		/** Records the name so the Settings list can badge it. */
		recordRefusal: (provider, tool) => {
			const name = tool.trim();
			const refused = refusalsOf(provider);
			if (
				!acceptsUserTrust(name, provider) ||
				refused.size >= MAX_REFUSED_TOOLS
			) {
				return;
			}
			refused.add(name);
		},
		/** Merges the inventory with the refused names, sorted by name. */
		listTools: (provider) => {
			const inventory = inventories.get(provider);
			const refused = refusals.get(provider) ?? new Set<string>();
			const names = new Set([...(inventory?.keys() ?? []), ...refused]);
			const tools: AgentProviderToolWire[] = [...names]
				.sort((left, right) => left.localeCompare(right))
				.map((name) => ({
					description: inventory?.get(name)?.description ?? null,
					name,
					refused: refused.has(name),
					source: inventory?.get(name)?.source ?? null,
				}));
			return { reported: inventory !== undefined, tools };
		},
	};
}
