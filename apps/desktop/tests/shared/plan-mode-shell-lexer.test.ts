import { describe, expect, it } from 'vitest';

import { lexCommand, lexShellSegments } from '@/shared/plan-mode';

/** Reads the tolerant lexer's segments as bare argv lists, or null when it found the line unreadable. */
function tokensOf(command: string): (readonly string[])[] | null {
	return lexShellSegments(command)?.map((segment) => segment.tokens) ?? null;
}

/** Reads the segments of a command the lexer accepted, failing the test if it did not. */
function segmentsOf(command: string): readonly (readonly string[])[] {
	const lexed = lexCommand(command);
	expect(lexed.violation).toBeNull();
	return lexed.segments;
}

describe('tokens', () => {
	it('splits a plain command on whitespace', () => {
		expect(segmentsOf('ls -la src')).toEqual([['ls', '-la', 'src']]);
	});

	it('keeps a quoted argument whole, whichever quote encloses it', () => {
		expect(segmentsOf('ls "/tmp/my repo (2)"')).toEqual([
			['ls', '/tmp/my repo (2)'],
		]);
		expect(segmentsOf("ls '/tmp/my repo (2)'")).toEqual([
			['ls', '/tmp/my repo (2)'],
		]);
	});

	it('joins a quoted run onto the token it interrupts', () => {
		expect(segmentsOf('git log --grep="fix; cleanup"')).toEqual([
			['git', 'log', '--grep=fix; cleanup'],
		]);
	});

	it('keeps a backslash literal inside double quotes, as bash does', () => {
		expect(segmentsOf('rg "\\w+" src')).toEqual([['rg', '\\w+', 'src']]);
	});

	it('unescapes the characters double quotes do escape', () => {
		expect(segmentsOf('echo "a\\"b"')).toEqual([['echo', 'a"b']]);
	});

	it('drops the leading backslash of an unquoted escape', () => {
		expect(segmentsOf('ls /tmp/my\\ dir')).toEqual([['ls', '/tmp/my dir']]);
	});

	it('emits an empty token for an empty quoted argument', () => {
		expect(segmentsOf('git "" log')).toEqual([['git', '', 'log']]);
	});
});

describe('segments', () => {
	it('splits on every unquoted separator', () => {
		expect(segmentsOf('ls | grep src').filter((s) => s.length > 0)).toEqual([
			['ls'],
			['grep', 'src'],
		]);
		expect(segmentsOf('ls; cat a').filter((s) => s.length > 0)).toEqual([
			['ls'],
			['cat', 'a'],
		]);
		expect(segmentsOf('ls && cat a').filter((s) => s.length > 0)).toEqual([
			['ls'],
			['cat', 'a'],
		]);
	});

	it('leaves a quoted separator inside its token', () => {
		expect(segmentsOf("rg 'foo|bar' src")).toEqual([['rg', 'foo|bar', 'src']]);
		expect(segmentsOf('grep -rn "a && b" src')).toEqual([
			['grep', '-rn', 'a && b', 'src'],
		]);
	});

	it('produces no segments for whitespace alone', () => {
		expect(segmentsOf('   ')).toEqual([]);
	});
});

describe('redirections', () => {
	it('accepts the discard forms and drops them from the tokens', () => {
		expect(segmentsOf('wc -l a.ts 2>/dev/null')).toEqual([
			['wc', '-l', 'a.ts'],
		]);
		expect(segmentsOf('cat a >/dev/null')).toEqual([['cat', 'a']]);
		expect(segmentsOf('cat a 1>/dev/null')).toEqual([['cat', 'a']]);
		expect(segmentsOf('ls &>/dev/null')).toEqual([['ls']]);
	});

	it('accepts a descriptor duplication', () => {
		expect(segmentsOf('ls 2>&1').at(0)).toEqual(['ls']);
	});

	it('rejects a target that only starts with the null sink', () => {
		expect(lexCommand('cat a >/dev/nullx').violation).toContain('redirection');
		expect(lexCommand('cat a 2>/dev/nullx').violation).toContain('redirection');
		expect(lexCommand('ls >/dev/null/../../tmp/x').violation).toContain(
			'redirection',
		);
	});

	it('rejects a write to a real file, appended or not', () => {
		expect(lexCommand('git diff > out.txt').violation).toContain('redirection');
		expect(lexCommand('git diff >> out.txt').violation).toContain('`>>`');
		expect(lexCommand('wc -l a.ts>out').violation).toContain('redirection');
	});

	it('reads an input redirection as a boundary, not a violation', () => {
		expect(segmentsOf('sort < in.txt')).toEqual([['sort', 'in.txt']]);
	});
});

describe('expansions', () => {
	it('rejects command substitution wherever bash would expand it', () => {
		expect(lexCommand('ls $(pwd)').violation).toContain('$(');
		expect(lexCommand('ls "$(rm -rf .)"').violation).toContain('$(');
		expect(lexCommand('ls `pwd`').violation).toContain('backticks');
		expect(lexCommand('echo "`pwd`"').violation).toContain('backticks');
	});

	it('leaves a substitution inside single quotes alone, as bash does', () => {
		expect(segmentsOf("grep -F '$(x)' a.ts")).toEqual([
			['grep', '-F', '$(x)', 'a.ts'],
		]);
	});

	it('rejects process substitution and heredocs', () => {
		expect(lexCommand('cat <(ls)').violation).toContain('<(');
		expect(lexCommand('cat << EOF').violation).toContain('<<');
	});

	it('allows parameter expansion, which runs nothing', () => {
		expect(segmentsOf(`ls \${HOME}`)).toEqual([['ls', `\${HOME}`]]);
	});
});

describe('unbalanced quotes', () => {
	it('refuses to guess where an unterminated quote ends', () => {
		expect(lexCommand('grep "foo src').violation).toContain('unbalanced');
		expect(lexCommand("rg 'foo src").violation).toContain('unbalanced');
	});
});

describe('line continuations', () => {
	// Bash deletes `\<newline>` outright. Pushing the newline in as a token landed
	// a phantom argument between the head word and its own arguments, and every
	// multi-line command an agent wrote came back falsely denied.
	it('deletes a continuation rather than tokenizing the newline', () => {
		expect(segmentsOf('git \\\nstatus')).toEqual([['git', 'status']]);
		expect(segmentsOf('cat \\\nfoo')).toEqual([['cat', 'foo']]);
		expect(segmentsOf('rg \\\n  --files \\\n  src')).toEqual([
			['rg', '--files', 'src'],
		]);
	});

	it('joins a word split across a continuation, as bash does', () => {
		expect(segmentsOf('l\\\ns -la')).toEqual([['ls', '-la']]);
		expect(segmentsOf('git sta\\\ntus')).toEqual([['git', 'status']]);
	});

	it('deletes a continuation inside double quotes too', () => {
		expect(segmentsOf('grep "foo\\\nbar" src')).toEqual([
			['grep', 'foobar', 'src'],
		]);
	});

	it('still escapes every other character', () => {
		expect(segmentsOf('ls /tmp/my\\ dir')).toEqual([['ls', '/tmp/my dir']]);
		expect(segmentsOf('grep "a\\"b" src')).toEqual([['grep', 'a"b', 'src']]);
	});

	it('reads a real newline as the separator it is', () => {
		expect(segmentsOf('ls\ncat foo')).toEqual([['ls'], ['cat', 'foo']]);
	});
});

describe('word boundaries are bash s blanks, not JavaScript s whitespace', () => {
	// Bash's blanks are space and tab alone. JavaScript's `\s` also matches each
	// of these, so the lexer used to split words bash keeps whole — a view of the
	// command that was provably not the shell's, which any rule reasoning from
	// token positions inherits.
	it.each([
		['\u00A0', 'no-break space'],
		['\u000B', 'vertical tab'],
		['\u000C', 'form feed'],
		['\u2028', 'line separator'],
		['\u2003', 'em space'],
		['\r', 'carriage return'],
	])('keeps a word whole across %j (%s)', (blank) => {
		expect(segmentsOf(`cat a${blank}rm b`)).toEqual([
			['cat', `a${blank}rm`, 'b'],
		]);
	});

	it('still splits on a space and a tab', () => {
		expect(segmentsOf('cat\ta\tb')).toEqual([['cat', 'a', 'b']]);
		expect(segmentsOf('cat  a   b')).toEqual([['cat', 'a', 'b']]);
	});
});

describe('lexShellSegments', () => {
	it('splits chained commands on every separator', () => {
		expect(tokensOf('cd x && bun run test; ls | wc -l & echo hi')).toEqual([
			['cd', 'x'],
			['bun', 'run', 'test'],
			['ls'],
			['wc', '-l'],
			['echo', 'hi'],
		]);
	});

	it('drops redirections and their targets instead of refusing them', () => {
		expect(tokensOf('bun run test > out.log 2>&1')).toEqual([
			['bun', 'run', 'test'],
		]);
		expect(tokensOf('make &>build.log')).toEqual([['make']]);
		expect(tokensOf('make >>"my log" 2> err < in')).toEqual([['make']]);
		expect(tokensOf('tsc 2>&1| tail -5')).toEqual([['tsc'], ['tail', '-5']]);
	});

	it('splits command substitutions and subshells into their own segments', () => {
		expect(tokensOf('echo $(date) && make')).toEqual([
			['echo'],
			['date'],
			['make'],
		]);
		expect(tokensOf('x=`git rev-parse HEAD` vitest')).toEqual([
			['x='],
			['git', 'rev-parse', 'HEAD'],
			['vitest'],
		]);
		expect(tokensOf('diff <(ls a) <(ls b)')).toEqual([
			['diff'],
			['ls', 'a'],
			['ls', 'b'],
		]);
		expect(tokensOf('(cd x; make -j8)')).toEqual([
			['cd', 'x'],
			['make', '-j8'],
		]);
	});

	it('drops bare group braces', () => {
		expect(tokensOf('{ make; }')).toEqual([['make']]);
	});

	it('keeps quoted text as one literal token and lexes its substitutions after it', () => {
		expect(tokensOf('echo "bun run test; $(make)"')).toEqual([
			['echo', 'bun run test; $(make)'],
			['make'],
		]);
		expect(tokensOf('x="$(echo ")" && tsc)" ls')).toEqual([
			['x=$(echo ")" && tsc)', 'ls'],
			['echo', ')'],
			['tsc'],
		]);
		expect(tokensOf('echo "a `make` b"')).toEqual([
			['echo', 'a `make` b'],
			['make'],
		]);
		expect(tokensOf("echo '$(make)'")).toEqual([['echo', '$(make)']]);
	});

	it('reads a never-closed substitution in quotes as literal text', () => {
		expect(tokensOf('echo "$(make"; ls')).toEqual([['echo', '$(make'], ['ls']]);
	});

	it('skips heredoc bodies inside a quoted substitution, apostrophes and all', () => {
		expect(
			tokensOf(
				`git commit -m "$(cat <<'EOF'\nit's fixed\nEOF\n)" && bun run test`,
			),
		).toEqual([
			['git', 'commit', '-m', "$(cat <<'EOF'\nit's fixed\nEOF\n)"],
			['bun', 'run', 'test'],
			['cat'],
		]);
		expect(tokensOf('x="$(cat <<-END\n\tdon\'t )\n\tEND\n)"; make')).toEqual([
			["x=$(cat <<-END\n\tdon't )\n\tEND\n)"],
			['make'],
			['cat'],
		]);
	});

	it('skips a comment inside a quoted substitution', () => {
		expect(tokensOf('x="$(ls # it\'s )\n)"; make')).toEqual([
			["x=$(ls # it's )\n)"],
			['make'],
			['ls'],
		]);
	});

	it('reads a process substitution whole and notes it on its command', () => {
		expect(lexShellSegments('source <(echo make) x')).toEqual([
			{
				pipesOnward: false,
				processInputs: ['echo make'],
				stdin: null,
				tokens: ['source', 'x'],
			},
			{
				pipesOnward: false,
				processInputs: [],
				stdin: null,
				tokens: ['echo', 'make'],
			},
		]);
	});

	it('stays within its bounds on pathological nesting instead of throwing', () => {
		const deep = `echo ${'"$('.repeat(6000)}make${')"'.repeat(6000)}; make`;
		expect(() => lexShellSegments(deep)).not.toThrow();
		const unclosed = `echo ${'"$('.repeat(6000)} ; make`;
		expect(() => lexShellSegments(unclosed)).not.toThrow();
	});

	it('skips heredoc bodies and comments', () => {
		expect(
			tokensOf("cat <<'EOF' > notes\nbun run test\nEOF\nls # make"),
		).toEqual([['cat'], ['ls']]);
		expect(tokensOf('cat <<-END\n\tmake\n\tEND\npwd')).toEqual([
			['cat'],
			['pwd'],
		]);
	});

	it('reads a here-string as a redirection rather than a heredoc', () => {
		expect(tokensOf('grep x <<< "make"\nls')).toEqual([['grep', 'x'], ['ls']]);
	});

	it('hands each heredoc body and here-string to the stdin of the command that opened it', () => {
		expect(lexShellSegments('cat <<EOF | sh\nbun run test\nEOF\nls')).toEqual([
			{
				pipesOnward: true,
				processInputs: [],
				stdin: 'bun run test',
				tokens: ['cat'],
			},
			{ pipesOnward: false, processInputs: [], stdin: null, tokens: ['sh'] },
			{ pipesOnward: false, processInputs: [], stdin: null, tokens: ['ls'] },
		]);
		expect(lexShellSegments('bash <<-END\n\tmake\n\tEND')).toEqual([
			{
				pipesOnward: false,
				processInputs: [],
				stdin: 'make',
				tokens: ['bash'],
			},
		]);
		expect(lexShellSegments('zsh <<< "make"')).toEqual([
			{
				pipesOnward: false,
				processInputs: [],
				stdin: 'make\n',
				tokens: ['zsh'],
			},
		]);
	});

	it('reads `||` as a chain rather than a pipe', () => {
		expect(
			lexShellSegments('a || b')?.map((segment) => segment.pipesOnward),
		).toEqual([false, false]);
	});

	it('lexes substitutions in an unquoted heredoc body, and none in a quoted one', () => {
		expect(tokensOf('cat <<EOF\n$(make)\nEOF')).toEqual([['cat'], ['make']]);
		expect(tokensOf("cat <<'EOF'\n$(make)\nEOF")).toEqual([['cat']]);
	});

	it('returns null only for an unbalanced quote', () => {
		expect(tokensOf('echo "oops')).toBeNull();
		expect(tokensOf("make 'x")).toBeNull();
		expect(tokensOf('')).toEqual([]);
	});

	it('leaves the strict lexer refusing what the tolerant one reads', () => {
		expect(lexCommand('echo $(date)').violation).not.toBeNull();
		expect(lexCommand('make > out').violation).not.toBeNull();
	});
});
