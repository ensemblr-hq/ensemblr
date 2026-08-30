// `node-pty` publishes prebuilds for darwin and win32 only, so every Linux host
// compiles it — and Forge does that compile lazily, inside `start`/`package`, an
// unbundling step deep enough that the only thing it prints is:
//
//     Error: node-gyp failed to rebuild '.../node_modules/node-pty'
//
// which names neither the missing compiler nor the fix. An immutable distro
// (SteamOS, Silverblue) ships no compiler at all, so that is the *first* thing a
// contributor sees there. Check before Forge starts and say what is missing.
//
// The second failure this catches is quieter. A `pty.node` compiled against a
// private prefix — Homebrew's `g++-16`, a Nix profile — carries an rpath into
// that prefix. It loads on the machine that built it and nowhere else, so it
// survives local testing and breaks every terminal in the shipped AppImage.
// Read the linkage back and refuse a binding that is not host-portable.
//
// The third is the one a bare `existsSync` misses. `npm ci` inside a Node
// container compiles node-pty against *Node's* ABI and writes no `.forge-meta`,
// so the file exists and links against nothing but `/lib`. Forge then finds no
// meta it recognises, shells out to node-gyp on the host anyway, and dies with
// the same bare error — on the one host that has no compiler. Compare the meta
// against the ABI Electron actually wants before declaring the binding usable.
import { execFileSync } from 'node:child_process';
import { accessSync, constants, existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BINDING = fileURLToPath(
	new URL('../node_modules/node-pty/build/Release/pty.node', import.meta.url),
);

// `@electron/rebuild` stamps `${arch}--${ABI}` here after a successful rebuild
// and skips the module when it matches (`module-rebuilder.js`, `metaData`).
// Reading it is the only way to tell a binding Forge will accept from one it
// will silently try to recompile.
const FORGE_META = fileURLToPath(
	new URL(
		'../node_modules/node-pty/build/Release/.forge-meta',
		import.meta.url,
	),
);

/** Compilers node-gyp probes for, in the order it probes for them. */
const COMPILERS = ['c++', 'g++', 'cc', 'clang++'];

/** Prefixes a shared library may resolve under and still run on any host. */
const SYSTEM_PREFIXES = ['/usr/', '/lib/', '/lib64/'];

/** Enough offending libraries to identify the prefix, before the list stops being read. */
const MAX_LISTED_LIBRARIES = 8;

const reportOnly = process.argv.includes('--report');

/**
 * Resolves a bare command name against PATH, without a shell — `command -v`
 * through `execFileSync(…, { shell: true })` is deprecated as of Node 26.
 * @param command - Command to look for.
 * @returns The resolved path, or null when it is not on PATH.
 */
function resolveCommand(command) {
	for (const directory of (process.env.PATH ?? '').split(delimiter)) {
		if (directory === '') {
			continue;
		}
		const candidate = join(directory, command);
		try {
			accessSync(candidate, constants.X_OK);
			return candidate;
		} catch {}
	}
	return null;
}

/**
 * Finds the compiler node-gyp would pick.
 * @returns The compiler name and path, or null when the host has none.
 */
function findCompiler() {
	for (const compiler of COMPILERS) {
		const path = resolveCommand(compiler);
		if (path) {
			return { name: compiler, path };
		}
	}
	return null;
}

/**
 * Resolves the ABI the packaged Electron loads native modules with, which is
 * what `@electron/rebuild` stamps into `.forge-meta` — not the host Node's.
 * Uses the same `node-abi` lookup that rebuild itself performs.
 * @returns The Electron version and its ABI, or null when neither resolves.
 */
function resolveElectronAbi() {
	try {
		const require = createRequire(import.meta.url);
		const { version } = require('electron/package.json');
		return {
			version,
			abi: String(require('node-abi').getAbi(version, 'electron')),
		};
	} catch {
		return null;
	}
}

/**
 * Reads the `${arch}--${ABI}` stamp `@electron/rebuild` leaves beside a binding
 * it built.
 * @returns The stamp, or null when the module was never rebuilt for Electron.
 */
function readForgeMeta() {
	try {
		return readFileSync(FORGE_META, 'utf8').trim();
	} catch {
		return null;
	}
}

/**
 * Reads back what the compiled binding links against. Entries whose target is
 * empty are dropped: older glibc prints the vDSO as `linux-vdso.so.1 => (0x…)`,
 * which resolves to nothing and is not a real dependency.
 * @param binding - Path to the `.node` file to inspect.
 * @returns One entry per dependency, or null when `ldd` cannot report.
 */
function readLinkage(binding) {
	let output;
	try {
		output = execFileSync('ldd', [binding], { encoding: 'utf8' });
	} catch {
		return null;
	}

	return output
		.split('\n')
		.map((line) => line.trim())
		.filter((line) => line.includes('=>'))
		.map((line) => {
			const [name, target] = line.split('=>').map((part) => part.trim());
			return { name, target: target.replace(/\s*\(0x[0-9a-f]+\)$/, '').trim() };
		})
		.filter(({ target }) => target !== '');
}

/**
 * Selects the dependencies that would not resolve the same way on another host —
 * either missing outright, or satisfied from a private prefix this machine
 * happens to have.
 * @param linkage - Dependencies as reported by `readLinkage`.
 * @returns The entries that make the binding non-portable.
 */
function findUnportableLinks(linkage) {
	return linkage.filter(
		({ target }) =>
			target === 'not found' ||
			!SYSTEM_PREFIXES.some((prefix) => target.startsWith(prefix)),
	);
}

/**
 * Prints the toolchain state as a table, for `npm run diagnose:linux`. The
 * Electron row is the one that matters when a `NODE_MODULE_VERSION` mismatch is
 * being chased: the rebuild targets Electron's ABI, never the host Node's.
 * @param compiler - The resolved compiler, or null.
 * @param linkage - Dependencies of the built binding, or null when unbuilt.
 * @param electron - Electron's version and ABI, or null when unresolvable.
 * @param meta - The binding's `.forge-meta` stamp, or null when it has none.
 */
function printReport(compiler, linkage, electron, meta) {
	const rows = [
		['node', process.versions.node],
		[
			'electron',
			electron ? `${electron.version} (ABI ${electron.abi})` : 'UNRESOLVABLE',
		],
		['compiler', compiler ? `${compiler.name} → ${compiler.path}` : 'MISSING'],
		['make', resolveCommand('make') ?? 'MISSING'],
		['python3', resolveCommand('python3') ?? 'MISSING'],
		['mksquashfs', resolveCommand('mksquashfs') ?? 'MISSING (make:linux only)'],
		['pty.node', existsSync(BINDING) ? BINDING : 'not built'],
		['built for', meta ?? 'no .forge-meta (not built by electron-rebuild)'],
	];

	for (const [label, value] of rows) {
		console.log(`${label.padEnd(12)} ${value}`);
	}

	if (linkage) {
		console.log('\nlinkage');
		for (const { name, target } of linkage) {
			console.log(`  ${name.padEnd(18)} ${target}`);
		}
	}
}

/**
 * Reports that Forge will have to compile the binding and the host cannot.
 * @param state - What is wrong with the binding today, as a sentence fragment.
 * @param missing - Names of the build tools that are absent.
 */
function refuseWithoutToolchain(state, missing) {
	console.error(
		[
			'',
			`✖ node-pty is ${state}, and this host cannot build it: ${missing.join(', ')} missing.`,
			'  node-pty ships no linux-x64 prebuild, so Forge compiles it from source —',
			'  it will fail with a bare "node-gyp failed to rebuild".',
			'',
			'  Fix (pick one):',
			'    • npm run rebuild:native   — compile it in a throwaway Debian container',
			'                                 (needs podman or docker; installs nothing here)',
			'    • Debian/Ubuntu:  sudo apt-get install -y build-essential python3',
			'    • Fedora:         sudo dnf install -y gcc-c++ make python3',
			'    • Arch:           sudo pacman -S --needed base-devel python',
			'',
			'  On an immutable root (SteamOS, Silverblue) prefer the container: it needs',
			'  no sudo password and survives the next OS update.',
			'',
		].join('\n'),
	);
	process.exit(1);
}

/**
 * Reports a built binding that only loads on this machine.
 * @param unportable - The dependencies that do not resolve from a system prefix.
 */
function refuseUnportableBinding(unportable) {
	const shown = unportable.slice(0, MAX_LISTED_LIBRARIES);
	const detail = shown.map(({ name, target }) => `    ${name} → ${target}`);

	if (unportable.length > shown.length) {
		detail.push(`    …and ${unportable.length - shown.length} more`);
	}

	console.error(
		[
			'',
			'✖ node-pty is built, but links against libraries no other host has:',
			...detail,
			'',
			'  It loads here and nowhere else, so terminals would be dead in the shipped',
			'  AppImage while working perfectly in local testing. This is what pointing',
			'  CXX at a Homebrew or Nix compiler produces.',
			'',
			'  Fix: rm -rf node_modules/node-pty/build && npm run rebuild:native',
			'',
		].join('\n'),
	);
	process.exit(1);
}

if (process.platform !== 'linux') {
	if (reportOnly) {
		console.log(`Not Linux (${process.platform}) — nothing to check.`);
	}
	process.exit(0);
}

const compiler = findCompiler();
const isBuilt = existsSync(BINDING);
const linkage = isBuilt ? readLinkage(BINDING) : null;
const electron = resolveElectronAbi();
const forgeMeta = isBuilt ? readForgeMeta() : null;

if (reportOnly) {
	printReport(compiler, linkage, electron, forgeMeta);
}

// With no ABI to compare against, an existing binding is taken at face value
// rather than refused: a false stop here would block `dev` on a host that is
// perfectly able to build.
const builtForElectron =
	isBuilt &&
	(electron === null || forgeMeta === `${process.arch}--${electron.abi}`);

if (!builtForElectron) {
	const missing = [
		compiler ? null : 'a C++ compiler',
		resolveCommand('make') ? null : 'make',
		resolveCommand('python3') ? null : 'python3',
	].filter(Boolean);

	if (missing.length > 0) {
		refuseWithoutToolchain(
			isBuilt
				? `built for ${forgeMeta ?? 'an unrecorded runtime'} rather than Electron's ${process.arch}--${electron?.abi}`
				: 'not built',
			missing,
		);
	}
	process.exit(0);
}

const unportable = linkage ? findUnportableLinks(linkage) : [];

if (unportable.length > 0) {
	refuseUnportableBinding(unportable);
}
