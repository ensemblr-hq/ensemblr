// `.nvmrc` pins Node 24 but nothing on PATH enforces it, and both halves of the
// build break quietly under the wrong major:
//   • package/make silently produce NO artifacts under Node 26 (the process
//     exits during "Finalizing package", exit code 0, empty out/).
//   • install compiles `macos-alias`/`fs-xattr` against whichever Node ran it,
//     so a later Node 24 `make` dies on NODE_MODULE_VERSION mismatch in the dmg
//     maker — long after the mistake was made.
// Fail loudly at both gates with the fix instead.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** What breaks under the wrong Node, keyed by the `--stage` the caller passes. */
const CONSEQUENCE = {
	build: (current) =>
		`electron-forge silently produces no artifacts under Node ${current}.`,
	install: (current) =>
		`native modules would be compiled for Node ${current} and fail to load when the build runs.`,
};

const stage = process.argv.includes('--stage=install') ? 'install' : 'build';
const nvmrc = fileURLToPath(new URL('../.nvmrc', import.meta.url));
const required = Number.parseInt(readFileSync(nvmrc, 'utf8').trim(), 10);
const current = Number.parseInt(process.versions.node.split('.')[0], 10);

// Guard a malformed .nvmrc (e.g. `v24`, `lts/*`, empty): without this, `required`
// is NaN, `current !== required` is always true, and the build fails with a
// confusing "Node NaN required" message instead of naming the real problem.
if (Number.isNaN(required)) {
	console.error(
		'✖ Could not read a major Node version from .nvmrc. Expected a bare number like "24".',
	);
	process.exit(1);
}

if (current !== required) {
	console.error(
		[
			'',
			`✖ Node ${required} required to ${stage}, but running Node ${process.versions.node}.`,
			`  ${CONSEQUENCE[stage](current)}`,
			'',
			'  Fix (pick one):',
			`    • nvm:  nvm use            (reads .nvmrc → ${required})`,
			`    • mise: mise use node@${required}`,
			`    • brew: export PATH="$(brew --prefix node@${required})/bin:$PATH"`,
			'',
		].join('\n'),
	);
	process.exit(1);
}
