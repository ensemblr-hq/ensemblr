// electron-forge package/make silently produce NO artifacts under Node 26
// (the process exits during "Finalizing package", exit code 0, empty out/).
// `.nvmrc` pins Node 24 but nothing enforces it, so a wrong `node` on PATH
// turns a build into a silent no-op that looks like a hang. Fail loudly here
// with the fix instead, so the build never silently produces nothing.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const nvmrc = fileURLToPath(new URL('../.nvmrc', import.meta.url));
const required = Number.parseInt(readFileSync(nvmrc, 'utf8').trim(), 10);
const current = Number.parseInt(process.versions.node.split('.')[0], 10);

if (current !== required) {
	console.error(
		[
			'',
			`✖ Node ${required} required to build, but running Node ${process.versions.node}.`,
			`  electron-forge silently produces no artifacts under Node ${current}.`,
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
