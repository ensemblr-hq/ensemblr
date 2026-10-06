/**
 * The two ops the bundled Claude Code mods call over `POST /invoke`:
 * `redactText`, which cleans text before the model sees it, and
 * `getLinkedIssue`, which hands a mod the issue the workspace was created from.
 * Neither is an MCP tool — the mods are their only callers.
 *
 * `redactText` is an oracle rather than a source: the mod runs inside the agent
 * process, so anything it could read the model could read too. The secret
 * values stay here, and only text with them replaced crosses back. That adds no
 * exposure the app does not already have: `runQueued` output is redacted
 * against the same values.
 */
import {
	type AgentControlResult,
	type GetLinkedIssueResult,
	MOD_CONTROL_LIMITS,
	type ModLinkedIssue,
	type RedactTextArgs,
	type RedactTextResult,
	type WorkspaceLinkedIssue,
} from '../../shared/agent-control.ts';
import {
	type NamedSecretValue,
	redactNamedSecrets,
} from '../../shared/redaction.ts';
import { CONTROL_TOKEN_ENV_KEY } from './control-env-keys.ts';
import type { OriginRegistry } from './origin-registry.ts';
import type { AgentControlOrigin, AgentControlPorts } from './ports.ts';

/** The mod ops the agent-control service composes. */
export interface ModOps {
	getLinkedIssue: (
		origin: AgentControlOrigin,
	) => Promise<AgentControlResult<GetLinkedIssueResult>>;
	redactText: (
		origin: AgentControlOrigin,
		args: RedactTextArgs,
	) => Promise<AgentControlResult<RedactTextResult>>;
}

/**
 * Wraps a payload in a success envelope.
 * @param data - The op's result.
 * @returns The envelope.
 */
function ok<T>(data: T): AgentControlResult<T> {
	return { ok: true, data };
}

/**
 * Cuts a string to a length without splitting a surrogate pair.
 * @param value - Text to cut.
 * @param limit - Most UTF-16 units to keep.
 * @returns The text, whole or cut.
 */
function capWholeCharacters(value: string, limit: number): string {
	if (value.length <= limit) {
		return value;
	}
	const lastKept = value.charCodeAt(limit - 1);
	const splitsAPair = lastKept >= 0xd800 && lastKept <= 0xdbff;
	return value.slice(0, splitsAPair ? limit - 1 : limit);
}

/**
 * Builds the mod ops over the ports and origin registry the service already holds.
 * @param deps - The service's ports and origin registry.
 * @returns The two op handlers.
 */
export function createModOps({
	originRegistry,
	ports,
}: {
	originRegistry: OriginRegistry;
	ports: Pick<AgentControlPorts, 'linear' | 'secretValues'>;
}): ModOps {
	/**
	 * Whether the caller is a workspace agent rather than the Concierge, which
	 * belongs to no workspace.
	 * @param origin - Resolved caller identity.
	 * @returns True when the caller has a workspace of its own.
	 */
	const hasWorkspace = (origin: AgentControlOrigin): boolean =>
		!origin.concierge && origin.workspaceId.length > 0;

	/**
	 * Every live control token that could have reached this caller's context:
	 * its own, and every one minted in its workspace. Read per call, because
	 * tokens come and go with sessions.
	 * @param origin - Resolved caller identity.
	 * @returns The tokens, each named after the variable that carries it.
	 */
	const liveControlTokens = (
		origin: AgentControlOrigin,
	): readonly NamedSecretValue[] => {
		const peers = hasWorkspace(origin)
			? originRegistry.originsInWorkspace(origin.workspaceId)
			: [];
		return [origin, ...peers].map((peer) => ({
			name: CONTROL_TOKEN_ENV_KEY,
			value: peer.token,
		}));
	};

	/**
	 * The caller's workspace secret values, or none for a caller without a
	 * workspace or when no port is wired.
	 * @param origin - Resolved caller identity.
	 * @returns The named values.
	 */
	const workspaceSecrets = async (
		origin: AgentControlOrigin,
	): Promise<readonly NamedSecretValue[]> =>
		ports.secretValues && hasWorkspace(origin)
			? await ports.secretValues
					.readSecretValues(origin.workspaceId)
					.catch(() => [])
			: [];

	/**
	 * Reads the linked issue's description off Linear, treating every failure
	 * as "no description" so the issue itself still reaches the mod.
	 * @param origin - Resolved caller identity.
	 * @param linked - The issue the workspace was created from.
	 * @returns The capped description, or null.
	 */
	const readDescription = async (
		origin: AgentControlOrigin,
		linked: WorkspaceLinkedIssue,
	): Promise<string | null> => {
		try {
			const result = await ports.linear.getIssue({
				issueId: linked.identifier,
				workspaceId: origin.workspaceId,
				...(linked.accountId ? { accountId: linked.accountId } : {}),
			});
			const description =
				result.status === 'ok' ? (result.issue?.description ?? null) : null;
			return description === null
				? null
				: capWholeCharacters(
						description,
						MOD_CONTROL_LIMITS.maxDescriptionChars,
					);
		} catch {
			return null;
		}
	};

	return {
		/**
		 * Reports the Linear issue the caller's workspace was created from.
		 * @param origin - Resolved caller identity.
		 * @returns The issue with its description, or `issue: null` when there is none.
		 */
		getLinkedIssue: async (origin) => {
			const linked = hasWorkspace(origin)
				? ports.linear.readLinkedIssue(origin.workspaceId)
				: null;
			if (linked?.provider !== 'linear') {
				return ok({ issue: null });
			}
			const issue: ModLinkedIssue = {
				description: await readDescription(origin, linked),
				identifier: linked.identifier,
				title: linked.title,
				url: linked.url,
			};
			return ok({ issue });
		},
		/**
		 * Replaces every exact secret value of the caller's workspace, and every
		 * live control token minted there, with a placeholder naming it.
		 * @param origin - Resolved caller identity.
		 * @param args - The text to redact.
		 * @returns The redacted text and how many spans were replaced.
		 */
		redactText: async (origin, args) => {
			const secrets = [
				...(await workspaceSecrets(origin)),
				...liveControlTokens(origin),
			];
			return ok(redactNamedSecrets(args.text, secrets));
		},
	};
}
