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
});
