import type { SubagentMechanism } from '../../shared/agent-control.ts';

/**
 * Claude Code's own sub-agent tool, under both names it has shipped under. The
 * tool was renamed from `Task` to `Agent` in Claude Code v2.1.63, and older
 * releases plus some permission-denial paths still speak the former, so a deny
 * list naming only one of them holds for only half the binaries a user may have
 * on PATH.
 */
const NATIVE_SUBAGENT_TOOLS = ['Agent', 'Task'] as const;

/**
 * Composes the SDK deny list for one session from the permission mode's own list
 * and the delegation mechanism the user picked.
 *
 * Merged rather than assigned: `read-only` already denies the mutating tools, and
 * a second `disallowedTools` key spread over the permission settings would drop
 * them and hand a planning session an editor.
 *
 * Under `ensemblr` the runtime's sub-agent tool is denied so delegation runs
 * through visible chat tabs. A descendant is denied regardless of mechanism,
 * because its one remaining edge must stay on authoritative Ensemblr lineage.
 * Under `native`, only a root receives the SDK's native delegation tool.
 * @param input - The permission deny list, mechanism, and validated depth.
 * @returns The deny list to pass to the SDK, or undefined when nothing is denied.
 */
export function resolveDisallowedTools({
	delegation,
	depth = 0,
	permissionDisallowedTools,
}: {
	delegation: SubagentMechanism;
	depth?: 0 | 1 | 2;
	permissionDisallowedTools?: readonly string[];
}): string[] | undefined {
	const denied = [
		...(permissionDisallowedTools ?? []),
		...(delegation === 'native' && depth === 0 ? [] : NATIVE_SUBAGENT_TOOLS),
	];
	return denied.length > 0 ? denied : undefined;
}
