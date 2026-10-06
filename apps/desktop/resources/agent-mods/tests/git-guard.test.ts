import type { On } from 'claude-code';
import { describe, expect, mock, test } from 'claude-code/testing';

import { findGitInvocations } from '../hooks/git-command.ts';
import { judgeGitInvocation } from '../hooks/git-policy.ts';

const ROOT = '/work/ensemblr/grieg';
const GIT_DIR = '/repos/ensemblr/.git/worktrees/grieg';
const SCOPE = { gitDir: GIT_DIR, root: ROOT };
const CONTEXT = { cwd: ROOT, home: '/home/me' };

function judge(command: string): (string | null)[] {
	return findGitInvocations(command, CONTEXT).map((invocation) =>
		judgeGitInvocation(invocation, SCOPE),
	);
}

function firstDenial(command: string): string | null {
	return judge(command).find((denial) => denial !== null) ?? null;
}

describe('reading a command line', () => {
	test('finds git behind operators, wrappers, assignments and substitutions', () => {
		const found = findGitInvocations(
			'cd sub && GIT_DIR=/x sudo git status; echo "$(git stash pop)" | env -i git log',
			CONTEXT,
		);
		expect(found.map((invocation) => invocation.subcommand)).toEqual([
			'status',
			'stash',
			'log',
		]);
		expect(found[0]?.targets).toEqual([{ path: '/x', source: 'GIT_DIR' }]);
	});

	test('does not mistake a quoted commit message for a command', () => {
		expect(
			findGitInvocations('git commit -m "fix; git stash pop"', CONTEXT).map(
				(invocation) => invocation.subcommand,
			),
		).toEqual(['commit']);
	});

	test('resolves -C chains, cd, ~ and exported GIT_WORK_TREE', () => {
		const [chained] = findGitInvocations(
			'git -C .. -C ./other status',
			CONTEXT,
		);
		expect(chained?.targets.at(-1)?.path).toBe('/work/ensemblr/other');
		const [afterCd] = findGitInvocations('cd /tmp && git -C repo log', CONTEXT);
		expect(afterCd?.targets[0]?.path).toBe('/tmp/repo');
		const [home] = findGitInvocations('git -C ~/code log', CONTEXT);
		expect(home?.targets[0]?.path).toBe('/home/me/code');
		const [exported] = findGitInvocations(
			'export GIT_WORK_TREE=../sibling; git add .',
			CONTEXT,
		);
		expect(exported?.targets[0]).toEqual({
			path: '/work/ensemblr/sibling',
			source: 'GIT_WORK_TREE',
		});
	});

	test('cannot read a path built from a variable', () => {
		const [found] = findGitInvocations('git -C "$OTHER" commit', CONTEXT);
		expect(found?.targets[0]?.path).toBeNull();
	});
});

describe('branch renames', () => {
	test('refuses -m, -M, --move and clusters, pointing at set_branch_name', () => {
		for (const command of [
			'git branch -m new-name',
			'git branch -M old new',
			'git branch --move new',
			'git branch -fm new',
		]) {
			expect(firstDenial(command)).toContain(
				'mcp__ensemblr__ensemblr_set_branch_name',
			);
		}
		expect(firstDenial('git branch -m x')).toContain('userRequested');
	});

	test('lets other branch calls through', () => {
		expect(firstDenial('git branch --merged')).toBeNull();
		expect(firstDenial('git branch feature/x')).toBeNull();
		expect(firstDenial('git branch -d done')).toBeNull();
	});
});

describe('the shared stash stack', () => {
	test('refuses bare stash, pop, clear, save, branch, and positional apply/drop', () => {
		for (const command of [
			'git stash',
			'git stash pop',
			'git stash pop stash@{0}',
			'git stash clear',
			'git stash save wip',
			'git stash branch b',
			'git stash apply',
			'git stash apply stash@{1}',
			'git stash drop',
			'git stash push -u',
			'git stash -u',
		]) {
			expect(firstDenial(command)).toContain('shared');
		}
	});

	test('allows the recipe: tagged push, apply by sha, list, show, drop by ref', () => {
		for (const command of [
			'git stash push -u -m "ensemblr-wip-1"',
			'git stash push --include-untracked --message=wip',
			'git stash -um tag',
			"git stash list --format='%H %gs'",
			'git stash show -p',
			'git stash apply 3f9c2ab1',
			'git stash drop stash@{2}',
		]) {
			expect(firstDenial(command)).toBeNull();
		}
	});
});

describe('git pointed outside the worktree', () => {
	test('refuses writes through -C, --git-dir, --work-tree, GIT_DIR and GIT_WORK_TREE', () => {
		for (const command of [
			'git -C ../sibling commit -m x',
			'git --git-dir=/repos/ensemblr/.git checkout main',
			'git --work-tree /repos/ensemblr add .',
			'GIT_DIR=/repos/ensemblr/.git git reset --hard',
			'export GIT_WORK_TREE=/repos/ensemblr && git add -A',
			'git -C "$ROOT" commit',
		]) {
			expect(firstDenial(command)).toContain('outside this session');
		}
	});

	test('lets reads look anywhere and lets writes stay home', () => {
		for (const command of [
			'git -C ../sibling log --oneline',
			'git -C /repos/ensemblr status',
			'git -C ../sibling diff main',
			'git -C ../sibling branch -a',
			'git -C ../sibling config --get user.name',
			`git -C ${ROOT}/apps commit -m x`,
			`GIT_DIR=${GIT_DIR} git status`,
			`git --git-dir=${GIT_DIR} commit -m x`,
			'git commit -m "touch ../sibling"',
		]) {
			expect(firstDenial(command)).toBeNull();
		}
	});

	test('treats a diff written to a file as a write', () => {
		expect(firstDenial('git -C ../sibling diff --output=x.patch')).toContain(
			'outside this session',
		);
	});
});

function answerEngine(on: On): void {
	mock.env(on, { HOME: '/home/me' });
	on('session.cwd', () => ({ value: ROOT }));
	on('process.run', () => ({
		value: {
			exitCode: 0,
			isStderrTruncated: false,
			isStdoutTruncated: false,
			stderr: '',
			stdout: `${ROOT}\n${GIT_DIR}\n`,
		},
	}));
	on('fs.stat', (_$, e) => ({
		value: {
			isLink: false,
			kind: 'dir' as const,
			mtimeMs: 0,
			realPath: e.path,
			size: 0,
		},
	}));
	on('tool.call', { tool: 'Bash' }, () => ({
		result: { interrupted: false, stderr: '', stdout: 'ran' },
	}));
}

function refusalOf(result: {
	deny?: string;
	isError?: true;
	text?: string;
}): string | undefined {
	return result.deny ?? (result.isError ? result.text : undefined);
}

test('the Bash hook denies a forbidden move and runs the rest', async ($, on) => {
	answerEngine(on);
	const denied = await $.tool.call({ command: 'git stash pop', tool: 'Bash' });
	expect(refusalOf(denied)).toContain('stash stack is shared');
	for (const command of ['git status', 'ls -la', 'git -C ../x log']) {
		const ran = await $.tool.call({ command, tool: 'Bash' });
		expect(refusalOf(ran)).toBeUndefined();
	}
});
