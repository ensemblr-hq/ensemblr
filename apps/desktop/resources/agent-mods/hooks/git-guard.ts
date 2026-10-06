/**
 * git-guard: refuses, before they run, the git moves Ensemblr's playbook forbids
 * — `git branch -m`, the shared stash stack outside its recipe, and git pointed
 * at a checkout other than this session's own. The playbook already says all
 * of this; a model that forgets it now hears it at the moment it matters.
 */
import type { EngineInterface, On } from 'claude-code';

import { findGitInvocations, type GitTarget } from './git-command.ts';
import { judgeGitInvocation, type WorktreeScope } from './git-policy.ts';

/** How long the one-off `git rev-parse` that finds the worktree may take. */
const SCOPE_PROBE_TIMEOUT_MS = 5_000;

/**
 * Resolves a path through symbolic links, so a link into a sibling checkout is
 * judged where it lands; a path that does not exist keeps its own spelling.
 * @param $ - The engine interface.
 * @param path - An absolute path.
 * @returns The real path, or the path as given.
 */
async function realPathOf($: EngineInterface, path: string): Promise<string> {
	try {
		return (await $.fs.stat(path, { resolve: true })).realPath ?? path;
	} catch {
		return path;
	}
}

/**
 * Finds the checkout this session owns: the worktree root and its git directory,
 * from git itself, falling back to the session's directory alone.
 * @param $ - The engine interface.
 * @returns The session's worktree scope.
 */
async function readWorktreeScope($: EngineInterface): Promise<WorktreeScope> {
	const cwd = await $.session.cwd();
	try {
		const probe = await $.process.run(
			['git', 'rev-parse', '--show-toplevel', '--absolute-git-dir'],
			{ cwd, timeoutMs: SCOPE_PROBE_TIMEOUT_MS },
		);
		const [root, gitDir] = probe.stdout.trim().split('\n');
		if (probe.exitCode === 0 && root && gitDir) {
			return {
				gitDir: await realPathOf($, gitDir),
				root: await realPathOf($, root),
			};
		}
	} catch {
		return { gitDir: null, root: await realPathOf($, cwd) };
	}
	return { gitDir: null, root: await realPathOf($, cwd) };
}

/**
 * Resolves a target's path through symbolic links.
 * @param $ - The engine interface.
 * @param target - One redirection of git.
 * @returns The target with its real path.
 */
async function realTarget(
	$: EngineInterface,
	target: GitTarget,
): Promise<GitTarget> {
	return target.path === null
		? target
		: { ...target, path: await realPathOf($, target.path) };
}

/**
 * Decides a Bash command: the first git invocation in it that breaks a rule.
 * @param $ - The engine interface.
 * @param command - The Bash command line.
 * @param scope - The session's worktree scope.
 * @returns The refusal, or null to let the command run.
 */
async function judgeCommand(
	$: EngineInterface,
	command: string,
	scope: WorktreeScope,
): Promise<string | null> {
	const home = (await $.env.get('HOME')) ?? null;
	const invocations = findGitInvocations(command, {
		cwd: await $.session.cwd(),
		home,
	});
	for (const invocation of invocations) {
		const targets = await Promise.all(
			invocation.targets.map((target) => realTarget($, target)),
		);
		const denial = judgeGitInvocation({ ...invocation, targets }, scope);
		if (denial !== null) {
			return denial;
		}
	}
	return null;
}

/**
 * Registers git-guard's Bash hook.
 * @param on - The plugin's registrar.
 */
export function registerGitGuard(on: On): void {
	let scope: Promise<WorktreeScope> | null = null;
	on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
		if (!/\bgit\b/.test(e.command)) {
			return next(e);
		}
		scope ??= readWorktreeScope($);
		const denial = await judgeCommand($, e.command, await scope);
		return denial === null ? next(e) : { deny: denial };
	});
}
