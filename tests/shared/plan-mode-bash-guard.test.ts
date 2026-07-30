import { describe, expect, it } from 'vitest';

import { isReadOnlyBashCommand } from '@/shared/plan-mode';

const ALLOWED = [
	'ls -la src',
	'cat package.json',
	'rg --files',
	'grep -rn "planMode" src',
	'head -20 README.md',
	'jq .name package.json',
	'FOO=bar ls',
	'wc -l src/main/main.ts 2>/dev/null',
	'ls 2>&1 | grep src',
	'cat package.json >/dev/null 2>&1',
	'git status',
	'git log --oneline -5',
	'git -C /tmp/repo status',
	'git branch',
	'git remote -v',
	'git config --get user.name',
	'gh pr view 123',
	'gh pr list --limit 5',
	'gh issue view 7',
	'gh repo view',
	'gh run list',
	'find . -name "*.ts"',
	'ls src && cat package.json',
	'rg planMode | head -5',
	// `-o` on grep/rg means `--only-matching` and only reads; the output-file
	// guard is scoped to the commands where `-o` actually writes (sort/tree).
	'rg -o "\\w+" src',
	'grep -o "planMode" src/main/main.ts',
	// `--pre-glob` only filters which files `--pre` runs on and executes nothing.
	'rg --pre-glob "*.md" planMode',
	'fd -e ts src',
	'date +%Y-%m-%d',
	'sort package.json',
	'tree -L 2 src',
	// `cd` cannot mutate anything, and what follows it is classified on its own.
	'cd src',
	'cd src && cat package.json',
	'cd /tmp/repo; git status',
	// Quoted arguments stay one token, so a path with a space still reaches the
	// git classifier as a path rather than splitting into a bogus subcommand.
	'git -C "/tmp/my repo (2)" remote -v',
	"git -C '/tmp/my repo (2)' log --oneline -5",
	'ls "/tmp/my repo (2)"',
	// Quotes suppress the characters that would otherwise read as redirection,
	// separation, or a heredoc.
	'grep -n "a > b" file',
	"rg 'foo|bar' src",
	'git log --grep="fix; cleanup"',
	'grep -rn "a && b" src',
	'grep -F "<<" src/main/main.ts',
	// Discarding both streams writes nothing either.
	'ls &>/dev/null',
	'wc -l README.md 1>/dev/null',
	// Bash allows whitespace between the operator and its target, so the spaced
	// form has to classify exactly like the tight one.
	'ls > /dev/null',
	'wc -l README.md 2> /dev/null',
	'grep -rn planMode src 2> /dev/null',
	'cat package.json > /dev/null 2> /dev/null',
	'ls &> /dev/null',
	// `git branch` only lists until a name or a flag turns it into ref surgery.
	'git branch -a',
	'git branch -vv',
	'git branch --list',
	'git branch --list "feat/*"',
	'git branch --contains HEAD',
	'git branch --merged main',
	'git branch --sort=-committerdate',
	// Inspection subcommands an investigator reaches for constantly.
	'git grep -n planMode',
	'git ls-tree -r HEAD --name-only',
	'git show-ref --tags',
	'git for-each-ref refs/heads --format="%(refname)"',
	'git rev-list --count HEAD',
	'git name-rev HEAD',
	'git count-objects -v',
	'git worktree list',
	'git stash list',
	'git stash show -p',
	'git remote get-url origin',
];

const DENIED = [
	'',
	'   ',
	'git diff > out.txt',
	'git diff >> out.txt',
	'echo hi >| out.txt',
	'$(rm -rf .)',
	'ls `pwd`',
	'cat <(ls)',
	'cat << EOF',
	'cat a && rm b',
	'echo x | tee f',
	'ls & rm x',
	'ls; rm -rf build',
	'find . -delete',
	'find . -exec rm {} ;',
	'find . -execdir touch x ;',
	'find . -fprint out.txt',
	"sed -i 's/a/b/' file",
	'awk "{print}" file',
	'node script.js',
	'npm run build',
	'npx tsc',
	'python3 -c "print(1)"',
	'make build',
	'sudo rm -rf /',
	'rm -rf build',
	'mv a b',
	'git commit -m "wip"',
	'git checkout -b feature',
	'git push origin main',
	'git branch -D feature',
	'git remote add origin git@example.com:x/y.git',
	'git remote set-url origin git@example.com:x/y.git',
	'git config user.name "someone"',
	'gh pr merge 1',
	'gh pr create --title x',
	'gh',
	// `env` runs whatever follows it, so it must not be an allowlisted head word.
	'env npm test',
	'env FOO=bar npm test',
	"env node -e \"require('fs').writeFileSync('x','')\"",
	'env',
	// Output flags write a file without any shell redirection to notice.
	'sort -o out.txt in.txt',
	'sort --output out.txt in.txt',
	'sort --output=out.txt in.txt',
	'tree -o out.txt',
	'git diff --output out.txt',
	'git diff --output=out.txt',
	'git log --output=out.txt',
	// `fd` and `rg` are on the read allowlist but execute arbitrary commands via
	// these flags, so they must be rejected like `find -exec`.
	'fd -x rm',
	'fd . --exec rm {}',
	'fd -X rm',
	'fd --exec-batch rm',
	'rg --pre ./evil.sh planMode',
	'rg --pre=./evil.sh planMode',
	'rg --hostname-bin ./evil planMode',
	// `date -s` sets the system clock rather than reading it.
	'date -s "2020-01-01"',
	'date --set 2020-01-01',
	// A target that merely starts with the null sink is a file like any other.
	'cat a >/dev/nullx',
	'cat a 2>/dev/nullx',
	'ls >/dev/null/../../tmp/x',
	'ls &>/dev/nullx',
	// Double quotes do not stop bash expanding a command substitution.
	'ls "$(rm -rf .)"',
	'echo "`rm -rf .`"',
	// `cd` is read-only; what it is chained to still is not.
	'cd /tmp && rm -rf x',
	'cd /tmp; git commit -m wip',
	// A quote left open makes the rest of the command unclassifiable.
	'grep "foo src',
	"rg 'foo src",
	// The named-action subcommands read only through their listing actions.
	'git worktree add ../wt feature',
	'git worktree remove ../wt',
	'git worktree',
	'git stash push -m wip',
	'git stash pop',
	// `git grep -O` hands every match to a pager command of the caller's choosing.
	'git grep -O rm planMode',
	'git grep --open-files-in-pager=rm planMode',
	// `git -c` names a program git then runs during an otherwise read-only
	// subcommand. Verified to execute with no terminal attached.
	'git -c diff.external=./evil.sh diff',
	'git -c core.fsmonitor=./evil.sh status',
	'git -c core.pager=./evil.sh log',
	'git -c diff.zz.textconv=./evil.sh diff',
	'git --config-env=diff.external=EVIL diff',
	'git --config-env diff.external=EVIL diff',
	'git --exec-path=/tmp/evil status',
	'git -c core.pager=./evil.sh --paginate log',
	// A bare name creates or resets a ref rather than listing.
	'git branch new-feature',
	'git branch new-feature main',
	'git branch -f main other',
	'git branch --force main other',
	'git branch --set-upstream-to=origin/main',
	'git branch --unset-upstream',
	'git branch --edit-description',
	'git branch -c old new',
];

describe('isReadOnlyBashCommand', () => {
	it.each(ALLOWED)('allows %j', (command) => {
		expect(isReadOnlyBashCommand(command)).toEqual({ ok: true });
	});

	it.each(DENIED)('denies %j', (command) => {
		const verdict = isReadOnlyBashCommand(command);
		expect(verdict.ok).toBe(false);
		if (!verdict.ok) {
			expect(verdict.reason.length).toBeGreaterThan(0);
		}
	});

	it('names the offending command in the reason', () => {
		const verdict = isReadOnlyBashCommand('cat a && rm b');
		expect(verdict.ok).toBe(false);
		if (!verdict.ok) {
			expect(verdict.reason).toContain('rm');
		}
	});

	it('explains that redirection is what was rejected', () => {
		const verdict = isReadOnlyBashCommand('git diff > out.txt');
		expect(verdict.ok).toBe(false);
		if (!verdict.ok) {
			expect(verdict.reason).toContain('redirection');
		}
	});

	it('rejects an unknown command rather than assuming it only reads', () => {
		expect(isReadOnlyBashCommand('some-unfamiliar-tool --help').ok).toBe(false);
	});

	it('says an output flag writes a file, not that the command is unknown', () => {
		const verdict = isReadOnlyBashCommand('sort -o out.txt in.txt');
		expect(verdict.ok).toBe(false);
		if (!verdict.ok) {
			expect(verdict.reason).toContain('writes its output to a file');
		}
	});

	it('keeps `find`’s `-o` operator working, which is not an output flag', () => {
		expect(
			isReadOnlyBashCommand('find . -name "*.ts" -o -name "*.tsx"'),
		).toEqual({ ok: true });
	});

	it('rejects `fd --exec`, naming the flag that runs a command', () => {
		const verdict = isReadOnlyBashCommand('fd -tf -x rm');
		expect(verdict.ok).toBe(false);
		if (!verdict.ok) {
			expect(verdict.reason).toContain('fd -x');
		}
	});

	it('allows `rg -o`, whose `-o` is `--only-matching`, not an output file', () => {
		expect(isReadOnlyBashCommand('rg -o "\\w+" src')).toEqual({ ok: true });
	});

	it('blames the chained command, not the `cd` that preceded it', () => {
		const verdict = isReadOnlyBashCommand('cd /tmp && rm -rf x');
		expect(verdict.ok).toBe(false);
		if (!verdict.ok) {
			expect(verdict.reason).toContain('rm');
			expect(verdict.reason).not.toContain('cd');
		}
	});

	it('rejects a discard target that only looks like the null sink', () => {
		const verdict = isReadOnlyBashCommand('cat a >/dev/nullx');
		expect(verdict.ok).toBe(false);
		if (!verdict.ok) {
			expect(verdict.reason).toContain('redirection');
		}
	});

	it('classifies a spaced discard exactly like the tight one', () => {
		expect(isReadOnlyBashCommand('wc -l README.md 2> /dev/null')).toEqual(
			isReadOnlyBashCommand('wc -l README.md 2>/dev/null'),
		);
		expect(isReadOnlyBashCommand('git diff > out.txt')).toEqual(
			isReadOnlyBashCommand('git diff >out.txt'),
		);
	});

	it('still rejects a spaced target that only looks like the null sink', () => {
		const verdict = isReadOnlyBashCommand('cat a > /dev/nullx');
		expect(verdict.ok).toBe(false);
		if (!verdict.ok) {
			expect(verdict.reason).toContain('redirection');
		}
	});

	it('blames `git -c`, which hands git a program to run', () => {
		const verdict = isReadOnlyBashCommand(
			'git -c diff.external=./evil.sh diff',
		);
		expect(verdict.ok).toBe(false);
		if (!verdict.ok) {
			expect(verdict.reason).toContain('-c');
			expect(verdict.reason).toContain('program');
		}
	});

	it('keeps the git global flags that only relocate what is read', () => {
		expect(isReadOnlyBashCommand('git -C /tmp/repo status')).toEqual({
			ok: true,
		});
		expect(
			isReadOnlyBashCommand('git --git-dir=/tmp/repo/.git log --oneline'),
		).toEqual({ ok: true });
	});

	it('says a bare branch name creates a ref rather than listing', () => {
		const verdict = isReadOnlyBashCommand('git branch new-feature');
		expect(verdict.ok).toBe(false);
		if (!verdict.ok) {
			expect(verdict.reason).toContain('branch');
		}
	});
});
