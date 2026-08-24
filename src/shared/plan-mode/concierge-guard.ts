/**
 * The Concierge's tool policy: which built-in tool calls it may make, and the
 * reason handed back when it may not.
 *
 * It lives beside the Plan Mode guard and reuses its bash classifier, because
 * the two answer the same question from opposite ends. Plan Mode blocks every
 * file write until a plan is approved; the Concierge blocks every file write
 * *outside its own folder*, forever. Both are reached the same way — the Pi
 * extension asks the app per intercepted tool call rather than carrying a copy
 * of a security-sensitive classifier — so both belong in `shared/` behind the
 * control server.
 */
import { isReadOnlyBashCommand } from './bash-guard.ts';

/** A tool call being classified: its name, its target path, and its command. */
export interface ConciergeToolRequest {
	/** Absolute path of the Concierge home, the one tree it may write. */
	conciergeHome: string;
	/** Command text, for `bash`. */
	command?: string;
	/** Target path, for `write`/`edit`. */
	path?: string;
	tool: string;
}

/** Whether a Concierge tool call may proceed, and why not when it may not. */
export interface ConciergeToolVerdict {
	blocked: boolean;
	reason?: string;
}

/**
 * Tool names that write files, across both first-class runtimes.
 *
 * Pi lower-cases its built-ins and Claude Code capitalizes them, and the guard
 * has to answer for whichever asked — so both spellings are members rather than
 * the check being case-insensitive, which would also swallow a differently-named
 * tool that merely looked similar.
 *
 * Every mutating built-in must be here: one left off is not classified, so the
 * extension forwards nothing and the call bypasses the policy silently.
 */
export const CONCIERGE_WRITE_TOOLS: ReadonlySet<string> = new Set([
	'Edit',
	'MultiEdit',
	'NotebookEdit',
	'Write',
	'edit',
	'write',
]);

/** Tool names that run a shell, restricted to read-only commands. */
export const CONCIERGE_SHELL_TOOLS: ReadonlySet<string> = new Set([
	'Bash',
	'bash',
]);

/**
 * Every tool the Concierge policy has an opinion about, and the set the shipped
 * Pi extension forwards on top of Plan Mode's — a Concierge runs on the same
 * runtimes a workspace agent does, so the extension gates on the union of the
 * two and a member here that it never forwards would be a policy nothing
 * applies. A parity test holds the extension's embedded copy against this one.
 */
export const CONCIERGE_GUARDED_TOOLS: ReadonlySet<string> = new Set([
	...CONCIERGE_WRITE_TOOLS,
	...CONCIERGE_SHELL_TOOLS,
]);

/**
 * Splits a path into its segments over either separator.
 *
 * Both are handled because a Windows-style path reaches a POSIX runtime as one
 * opaque segment, which would hide a `..` from the climb check.
 * @param value - The path to split.
 * @returns Its segments, empty ones dropped.
 */
function segmentsOf(value: string): string[] {
	return value.split(/[\\/]/).filter((segment) => segment.length > 0);
}

/**
 * Reports whether a path would be rewritten by something else before the tool
 * that receives it opens anything.
 *
 * A leading `~` is home expansion and a `$` is a variable, and neither resolves
 * to text this guard can see — so a path carrying one is refused rather than
 * walked as the literal it is not. `~/.ssh/authorized_keys` is not a relative
 * path under the Concierge home, which is how walking it would read it.
 * @param candidate - The path the tool call names.
 * @param segments - That path's segments.
 * @returns True when the path depends on an expansion this guard cannot resolve.
 */
function dependsOnShellExpansion(
	candidate: string,
	segments: readonly string[],
): boolean {
	return candidate.includes('$') || segments[0]?.startsWith('~') === true;
}

/**
 * Reports whether a tool's target path stays inside the Concierge home.
 *
 * Hand-rolled rather than delegated to `node:path` because this module is shared
 * with the renderer bundle. A relative path is resolved against the home, an
 * absolute one against itself, and `..` is walked so a path that climbs and
 * returns is admitted while one that climbs out is not. An empty home admits
 * nothing: the migration that added the column backfilled it empty, so a home
 * that has not been resolved yet is a real state and must fail closed.
 * @param home - Absolute path of the Concierge home.
 * @param candidate - The path the tool call names.
 * @returns True when the resolved path is the home or lives under it.
 */
export function pathStaysInConciergeHome(
	home: string,
	candidate: string,
): boolean {
	const candidateSegments = segmentsOf(candidate);
	if (
		!candidate ||
		candidate.includes('\0') ||
		dependsOnShellExpansion(candidate, candidateSegments)
	) {
		return false;
	}

	const homeSegments = segmentsOf(home);
	if (homeSegments.length === 0) {
		return false;
	}

	const isAbsolute =
		/^[\\/]/.test(candidate) || /^[A-Za-z]:[\\/]/.test(candidate);
	const walked = isAbsolute ? [] : [...homeSegments];

	for (const segment of candidateSegments) {
		if (segment === '.') {
			continue;
		}
		if (segment === '..') {
			if (walked.length === 0) {
				return false;
			}
			walked.pop();
			continue;
		}
		walked.push(segment);
	}

	if (walked.length < homeSegments.length) {
		return false;
	}
	return homeSegments.every((segment, index) => walked[index] === segment);
}

/**
 * Wraps a refusal in a verdict, naming what to do instead.
 *
 * Every Concierge denial ends the same way on purpose: the model is not stuck,
 * it is holding the wrong tool, and the right one is to put an agent in the
 * workspace that needs changing.
 * @param cause - What about this call is not allowed.
 * @returns The blocked verdict carrying the full reason.
 */
function blocked(cause: string): ConciergeToolVerdict {
	return {
		blocked: true,
		reason: `${cause} As the Concierge you are read-only outside your own folder: you supervise the work rather than doing it. Spawn an orchestrator into the workspace that needs changing with \`ensemblr_start_conversation\` and brief it, or write what you found to your own \`artifacts/\` folder.`,
	};
}

/**
 * Classifies a Concierge tool call: a file write is allowed only inside the
 * Concierge home, `bash` is restricted to read-only commands, and every other
 * tool runs untouched.
 * @param request - The tool name, the path it targets, the command it would run, and the home.
 * @returns Whether the call is blocked, with a reason when it is.
 */
export function evaluateConciergeTool({
	conciergeHome,
	command,
	path,
	tool,
}: ConciergeToolRequest): ConciergeToolVerdict {
	if (CONCIERGE_WRITE_TOOLS.has(tool)) {
		if (!path) {
			return blocked(`\`${tool}\` was called without a path to check.`);
		}
		return pathStaysInConciergeHome(conciergeHome, path)
			? { blocked: false }
			: blocked(
					`\`${tool}\` cannot write \`${path}\`, which is outside your own folder.`,
				);
	}

	if (CONCIERGE_SHELL_TOOLS.has(tool)) {
		const verdict = isReadOnlyBashCommand(command ?? '');
		return verdict.ok
			? { blocked: false }
			: blocked(
					`this \`${tool}\` command is not read-only: ${verdict.reason}.`,
				);
	}

	return { blocked: false };
}
