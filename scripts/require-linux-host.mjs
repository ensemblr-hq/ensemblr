// `electron-forge --platform=linux` cross-packages almost everything from macOS:
// it downloads the linux-x64 Electron and the shell really is an ELF binary. The
// one thing it cannot do is build a native module for a foreign platform.
//
// `node-pty` publishes prebuilds for darwin and win32 only, so Linux has to
// compile it — and `@electron/rebuild` on a Mac has no Linux toolchain to do it
// with. It does not fail: it reports "Preparing native dependencies: 1 / 1" and
// packages the Mach-O `pty.node` sitting in node_modules. The AppImage builds,
// installs, and launches; every terminal in it is dead, with the mistake made an
// hour and a whole release earlier.
//
// Refuse instead, and name the two ways out.
import { accessSync, constants } from 'node:fs';
import { delimiter, join } from 'node:path';

const ESCAPE_HATCH = 'ENSEMBLR_ALLOW_CROSS_PLATFORM_LINUX_BUILD';

if (process.platform === 'linux') {
	process.exit(0);
}

if (
	['1', 'true', 'yes'].includes((process.env[ESCAPE_HATCH] ?? '').toLowerCase())
) {
	console.warn(
		[
			'',
			`⚠ ${ESCAPE_HATCH} is set: building a Linux package on ${process.platform}.`,
			'  node-pty will be packaged as a host binary, so terminals will not work',
			'  in the result. Use it to exercise the packaging plumbing, never to ship.',
			'',
		].join('\n'),
	);
	process.exit(0);
}

/**
 * Reports whether a command exists on PATH, so the suggested fix names a tool
 * the machine actually has rather than one more thing to install. Walks PATH
 * directly rather than shelling out to `command -v`, which needs
 * `execFileSync(…, { shell: true })` — deprecated as of Node 26, and the same
 * walk `require-linux-toolchain.mjs` does. It is duplicated rather than shared
 * because that script exits at module scope, so importing from it here would
 * end this process before it could refuse.
 * @param command - Bare command name to probe.
 * @returns True when the command resolves.
 */
function isInstalled(command) {
	for (const directory of (process.env.PATH ?? '').split(delimiter)) {
		if (directory === '') {
			continue;
		}
		try {
			accessSync(join(directory, command), constants.X_OK);
			return true;
		} catch {}
	}
	return false;
}

const dockerHint = isInstalled('docker')
	? '    • Docker: run the build in a linux/amd64 container (docker is installed)'
	: '    • Docker: install it, then run the build in a linux/amd64 container';

console.error(
	[
		'',
		`✖ A Linux package must be built on Linux, but this is ${process.platform}.`,
		'  node-pty ships no linux-x64 prebuild, and @electron/rebuild cannot compile',
		'  one from here — Forge reports success and packages the host binary, so the',
		'  AppImage would launch with every terminal broken.',
		'',
		'  Fix (pick one):',
		'    • CI: push the tag and let the build-linux job in release.yml do it',
		dockerHint,
		`    • Override, knowing terminals will be broken: ${ESCAPE_HATCH}=1`,
		'',
	].join('\n'),
);
process.exit(1);
