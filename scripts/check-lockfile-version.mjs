// Dependabot's bun ecosystem pins MAX_SUPPORTED_LOCKFILE_VERSION = 1, and its
// parser raises on anything higher rather than degrading — dependency PRs stop
// arriving and nothing in this repository says why. Bun 1.4 raised its own
// default stamp to 2, so any lockfile regenerated from scratch under a current
// Bun is one Dependabot cannot read.
//
// `bun.lock` here was produced by migrating `package-lock.json` (`bun pm
// migrate` under Bun 1.4.2, which is the only version that parses an npm v3
// lockfile), stamping it version 1, and letting Bun 1.3.13 — which understands
// only version 1 — load and rewrite it. That sequence is what keeps the
// dependency graph byte-identical to the npm tree it replaced. Every later
// install preserves the version it loaded, under 1.3.13 and 1.4.2 alike.
//
// The pin is temporary: MAX_SUPPORTED_LOCKFILE_VERSION tracks the Bun that
// dependabot-core bundles and will rise. Raise SUPPORTED_LOCKFILE_VERSION here
// in the same change that regenerates the lockfile.
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SUPPORTED_LOCKFILE_VERSION = 1;

const lockfile = fileURLToPath(new URL('../bun.lock', import.meta.url));
const binaryLockfile = fileURLToPath(new URL('../bun.lockb', import.meta.url));

/**
 * Reads the `lockfileVersion` out of a text lockfile's header. `bun.lock` is
 * JSONC with trailing commas, so it cannot be handed to `JSON.parse`.
 * @param contents - Raw text of `bun.lock`.
 * @returns The declared lockfile version, or null when the field is absent.
 */
function readLockfileVersion(contents) {
	const match = contents.match(/"lockfileVersion"\s*:\s*(\d+)/);
	return match ? Number.parseInt(match[1], 10) : null;
}

/**
 * Prints the failure and exits non-zero.
 * @param lines - Message lines, printed in order between blank lines.
 */
function fail(lines) {
	console.error(['', ...lines, ''].join('\n'));
	process.exit(1);
}

if (existsSync(binaryLockfile)) {
	fail([
		'✖ bun.lockb (binary lockfile) exists.',
		'  Dependabot only parses the text lockfile, so dependency PRs would stop.',
		'',
		'  Fix:',
		'    • Delete bun.lockb. bunfig.toml sets saveTextLockfile = true, so',
		'      `bun install` writes bun.lock instead.',
	]);
}

if (!existsSync(lockfile)) {
	fail([
		'✖ bun.lock is missing.',
		'  The lockfile is committed and `bun ci` requires it.',
		'',
		'  Fix:',
		'    • git checkout HEAD -- bun.lock',
	]);
}

const version = readLockfileVersion(readFileSync(lockfile, 'utf8'));

if (version === null) {
	fail([
		'✖ Could not read "lockfileVersion" from bun.lock.',
		'  The lockfile format changed; check what Dependabot supports before',
		'  relaxing this guard.',
	]);
}

if (version !== SUPPORTED_LOCKFILE_VERSION) {
	fail([
		`✖ bun.lock is lockfileVersion ${version}; Dependabot supports ${SUPPORTED_LOCKFILE_VERSION}.`,
		'  Dependency PRs would stop arriving.',
		'',
		'  Fix — restore the committed lockfile rather than regenerating it, so',
		'  the dependency graph does not move at the same time:',
		'    • git checkout HEAD -- bun.lock && bun install',
		'',
		'  If it genuinely has to be rebuilt, stamp the version back to',
		`  ${SUPPORTED_LOCKFILE_VERSION} by hand and re-run \`bun install\` under a Bun that`,
		'  predates the default bump (1.3.13), which validates the downgrade by',
		'  refusing to load anything it cannot parse.',
	]);
}
