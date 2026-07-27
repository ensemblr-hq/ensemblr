// electron-forge package/make silently produce NO artifacts under Node 26
// (the process exits during "Finalizing package", exit code 0, empty out/).
// `.nvmrc` pins Node 24 and `nub run` provisions it, but a build started outside
// nub gets whatever `node` is on PATH, which turns it into a silent no-op that
// looks like a hang. Fail loudly here with the fix instead.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

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
			`✖ Node ${required} required to build, but running Node ${process.versions.node}.`,
			`  electron-forge silently produces no artifacts under Node ${current}.`,
			'',
			'  Fix (pick one):',
			`    • nub:  nub run make       (provisions Node ${required} from .nvmrc)`,
			`    • nvm:  nvm use            (reads .nvmrc → ${required})`,
			`    • brew: export PATH="$(brew --prefix node@${required})/bin:$PATH"`,
			'',
		].join('\n'),
	);
	process.exit(1);
}
