import { describe, expect, it } from 'vitest';

import {
	classifyHeavyCommand,
	classifyHeavyCommandForSettings,
	DEFAULT_HEAVY_COMMAND_PATTERNS,
	heavyCommandBlockReason,
} from '@/shared/compute-queue';
import type { ComputeQueueSettings } from '@/shared/config';

const SETTINGS: ComputeQueueSettings = {
	concurrency: 1,
	enabled: true,
	exemptPatterns: [],
	extraPatterns: [],
	niceness: 10,
};

describe('classifyHeavyCommand', () => {
	it.each([
		['bun run test', 'run test*'],
		['cd apps/desktop && bun run test', 'run test*'],
		['bun run --cwd apps/desktop typecheck', 'run typecheck*'],
		['bun run test > out.log 2>&1', 'run test*'],
		['bun run test 2>&1 | tail -50', 'run test*'],
		['echo $(date) && bun run build', 'run build*'],
		['git status; bun run check:lockfile', 'run check*'],
		['CI=1 FORCE_COLOR=0 bun run test', 'run test*'],
		['env -i CI=1 bun run lint', 'run lint*'],
		['time nice -n 10 bun test', 'bun test'],
		['nohup ionice -c 3 make -j8 &', 'make'],
		['sudo -E -u builder make install', 'make'],
		['timeout --signal=KILL 10m cargo test', 'cargo test'],
		['command make', 'make'],
		['xargs -n 1 -P 4 tsc', 'tsc'],
		['bunx vitest run x', 'vitest'],
		['bun x vitest', 'vitest'],
		['npx -y jest', 'jest'],
		['pnpm exec vitest run', 'vitest'],
		['pnpm --filter web dlx tsc', 'tsc'],
		['yarn dlx eslint .', 'eslint'],
		['python -m pytest -x', 'pytest'],
		['python3.12 -mpytest', 'pytest'],
		['uv run pytest', 'pytest'],
		['./node_modules/.bin/tsc -p .', 'tsc'],
		['/usr/bin/make', 'make'],
		['npm test', 'run test*'],
		['npm run-script build', 'run build*'],
		['npm -w desktop run typecheck', 'run typecheck*'],
		['pnpm test:unit', 'run test*'],
		['pnpm -C apps/desktop build', 'run build*'],
		['yarn test', 'run test*'],
		['yarn workspace web build', 'run build*'],
		['bun e2e', 'run e2e*'],
		['bun run tsc --noEmit', 'tsc'],
		["bash -lc 'bun run build'", 'run build*'],
		['sh -c "cd x && make"', 'make'],
		['zsh -ec \'bash -c "cargo build"\'', 'cargo build'],
		['nix develop -c cargo test', 'cargo test'],
		['nix develop .#ci --command bash -c "go test ./..."', 'go test'],
		["nix-shell --run 'make check'", 'make'],
		['(cd x; make -j8)', 'make'],
		['{ make; }', 'make'],
		['if bun run test; then echo ok; fi', 'run test*'],
		['for d in a b; do make -C $d; done', 'make'],
		['docker compose build web', 'docker compose build'],
		['sudo nixos-rebuild switch --flake .#host', 'nixos-rebuild'],
		['nh os switch', 'nh os'],
		['./gradlew assemble', 'gradlew'],
	])('classifies %j as heavy via %j', (command, matched) => {
		expect(classifyHeavyCommand(command)).toEqual({ heavy: true, matched });
	});

	it.each([
		'git status',
		'ls -la',
		'rg foo',
		'bun add zod',
		'bun install',
		'bun ci',
		'npm install',
		'pnpm add -D vitest',
		'cat package.json',
		'echo "bun run test"',
		'grep -r vitest src',
		'biome check src',
		'bun run dev',
		'command -v make',
		'python script.py',
		'bash script.sh',
		'nix develop',
		'cat <<EOF\nbun run test\nEOF',
		'ls # && make',
		'makepkg -si',
		'',
	])('leaves %j alone', (command) => {
		expect(classifyHeavyCommand(command)).toEqual({ heavy: false });
	});

	it.each([
		['out="$(bun run test 2>&1)"; echo "$out"', 'run test*'],
		['echo "$(bunx tsc --noEmit)"', 'tsc'],
		['x=`make`', 'make'],
		['echo "built: `cargo build`"', 'cargo build'],
		['echo "$(echo "$(make)")"', 'make'],
		['bash <<EOF\nbun run test\nEOF', 'run test*'],
		["sh -s <<'EOF'\nmake -j8\nEOF", 'make'],
		['cat <<EOF | sh\nbun run build\nEOF', 'run build*'],
		['bash -s -- arg <<EOF\ntsc\nEOF', 'tsc'],
		['zsh <<< "cargo test"', 'cargo test'],
		['echo "bun run test" | bash', 'run test*'],
		['cat <<EOF\n$(make)\nEOF', 'make'],
		[
			"git commit -m \"$(cat <<'EOF'\nit's fixed\nEOF\n)\" && bun run test",
			'run test*',
		],
		[
			"gh pr create --body \"$(cat <<'EOF'\nDon't break it\nEOF\n)\"; bun run build",
			'run build*',
		],
		['echo "$(make"; bun run test', 'run test*'],
		['eval "bun run test"', 'run test*'],
		['eval bun run test', 'run test*'],
		['source <(echo bun run test)', 'run test*'],
		['. <(printf "make\\n")', 'make'],
		['bash <(echo make)', 'make'],
		['bash <(cat <<EOF\ntsc\nEOF\n)', 'tsc'],
		['watch -n 5 bun run test', 'run test*'],
		["watch 'bun run test'", 'run test*'],
		['find . -name "*.rs" -exec cargo build \\;', 'cargo build'],
		['find . -execdir ls \\; -exec tsc {} +', 'tsc'],
		["echo $'it\\'s' && bun run test", 'run test*'],
		["git commit -m $'don\\'t' && make", 'make'],
		["x=\"$(echo $'a\\')b'; make)\"", 'make'],
		['echo $((1<<2))\nbun run test', 'run test*'],
		['(( x <<= 2 ))\nmake', 'make'],
		['echo "$((1<<2))"\nbun run test', 'run test*'],
		['x="$(echo $((3<<1)); y)"\ntsc', 'tsc'],
		['cargo t', 'cargo t'],
		['cargo b --release', 'cargo b'],
	])('follows %j into the command it runs, via %j', (command, matched) => {
		expect(classifyHeavyCommand(command)).toEqual({ heavy: true, matched });
	});

	it.each([
		'git commit -m "run tests"',
		'echo "bun run test" > notes.txt',
		"cat <<'EOF'\n$(make)\nEOF",
		'bash script.sh <<EOF\nbun run test\nEOF',
		'cat <<EOF | grep x\nbun run test\nEOF',
		'echo "bun run test" || bash',
		'cargo add serde',
		'diff <(echo make) <(echo tsc)',
		'find . -name "*.ts" -exec grep -l vitest {} +',
		'watch -n 1 git status',
		'eval "$(ssh-agent -s)"',
	])('still leaves %j alone', (command) => {
		expect(classifyHeavyCommand(command)).toEqual({ heavy: false });
	});

	it('leaves variable indirection and filters into a shell unread, as documented', () => {
		expect(classifyHeavyCommand('T=vitest; $T run')).toEqual({ heavy: false });
		expect(
			classifyHeavyCommand('echo bun run test | tee /dev/null | sh'),
		).toEqual({ heavy: false });
	});

	it('classifies pathological nesting and huge documents without throwing or stalling', () => {
		const deep = `echo ${'"$('.repeat(6000)}x${')"'.repeat(6000)}; bun run test`;
		const huge = `bash <<EOF\n${'echo line\n'.repeat(200_000)}EOF\nls`;
		const started = Date.now();
		expect(classifyHeavyCommand(deep)).toEqual({
			heavy: true,
			matched: 'run test*',
		});
		expect(classifyHeavyCommand(huge)).toEqual({ heavy: false });
		expect(Date.now() - started).toBeLessThan(2_000);
	});

	it('fails open on an unbalanced quote', () => {
		expect(classifyHeavyCommand('bun run test "oops')).toEqual({
			heavy: false,
		});
	});

	it('adds extra patterns, matched in their normalised form', () => {
		expect(
			classifyHeavyCommand('bun run storybook', {
				extraPatterns: ['bun run storybook*'],
			}),
		).toEqual({ heavy: true, matched: 'bun run storybook*' });
		expect(
			classifyHeavyCommand('npx my-slow-tool --all', {
				extraPatterns: ['my-slow-*'],
			}),
		).toEqual({ heavy: true, matched: 'my-slow-*' });
	});

	it('lets an exempt pattern override a default match', () => {
		expect(
			classifyHeavyCommand('bun run test:quick', {
				exemptPatterns: ['run test:quick'],
			}),
		).toEqual({ heavy: false });
		expect(
			classifyHeavyCommand('make docs', { exemptPatterns: ['make docs'] }),
		).toEqual({ heavy: false });
	});

	it('exempts per command, so another heavy command on the line still counts', () => {
		expect(
			classifyHeavyCommand('make docs && make', {
				exemptPatterns: ['make docs'],
			}),
		).toEqual({ heavy: true, matched: 'make' });
	});

	it('ignores patterns that name no command', () => {
		expect(
			classifyHeavyCommand('ls', { extraPatterns: ['', '   ', 'env'] }),
		).toEqual({ heavy: false });
	});

	it('keeps installs and quick tools off the default list', () => {
		expect(DEFAULT_HEAVY_COMMAND_PATTERNS).not.toContain('bun install');
		expect(DEFAULT_HEAVY_COMMAND_PATTERNS).not.toContain('git');
	});
});

describe('classifyHeavyCommandForSettings', () => {
	it('classifies nothing heavy while the queue is disabled', () => {
		expect(
			classifyHeavyCommandForSettings('bun run test', {
				...SETTINGS,
				enabled: false,
			}),
		).toEqual({ heavy: false });
	});

	it('applies the settings lists', () => {
		expect(
			classifyHeavyCommandForSettings('bun run test', {
				...SETTINGS,
				exemptPatterns: ['run test'],
			}),
		).toEqual({ heavy: false });
		expect(
			classifyHeavyCommandForSettings('hugo build', {
				...SETTINGS,
				extraPatterns: ['hugo'],
			}),
		).toEqual({ heavy: true, matched: 'hugo' });
	});
});

describe('heavyCommandBlockReason', () => {
	it('names the pattern, both tools, and the JSON-escaped command', () => {
		const reason = heavyCommandBlockReason({
			command: 'echo "a" && bun run test',
			matched: 'run test*',
			queueToolName: 'ensemblr_run_queued',
			waitToolName: 'ensemblr_wait_for_job',
		});
		expect(reason).toContain('`run test*`');
		expect(reason).toContain(
			'`ensemblr_run_queued` with {"command":"echo \\"a\\" && bun run test"}',
		);
		expect(reason).toContain('`ensemblr_wait_for_job`');
		expect(reason).toContain('timedOut');
	});
});
