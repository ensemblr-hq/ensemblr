// node-pty ships spawn-helper prebuilds without the exec bit; a non-executable
// helper surfaces later as an obscure PTY spawn failure, so fix it at install
// time and fail loudly when chmod itself errors.
import { chmodSync, globSync } from 'node:fs';

const helpers = globSync('node_modules/node-pty/prebuilds/*/spawn-helper');

for (const helper of helpers) {
	chmodSync(helper, 0o755);
}

if (helpers.length > 0) {
	console.log(
		`fix-node-pty-permissions: marked ${helpers.length} spawn-helper binarie(s) executable.`,
	);
}
