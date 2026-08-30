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
import { execFileSync } from 'node:child_process';
import { accessSync, constants, existsSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BINDING = fileURLToPath(
	new URL('../node_modules/node-pty/build/Release/pty.node', import.meta.url),
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
 * Reads back what the compiled binding links against.
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
			return { name, target: target.replace(/\s*\(0x[0-9a-f]+\)$/, '') };
		});
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
 * Prints the toolchain state as a table, for `npm run diagnose:linux`.
 * @param compiler - The resolved compiler, or null.
 * @param linkage - Dependencies of the built binding, or null when unbuilt.
 */
function printReport(compiler, linkage) {
	const rows = [
		['node', `${process.versions.node} (electron rebuild target)`],
		['compiler', compiler ? `${compiler.name} → ${compiler.path}` : 'MISSING'],
		['make', resolveCommand('make') ?? 'MISSING'],
		['python3', resolveCommand('python3') ?? 'MISSING'],
		['mksquashfs', resolveCommand('mksquashfs') ?? 'MISSING (make:linux only)'],
		['pty.node', existsSync(BINDING) ? BINDING : 'not built'],
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
 * Reports that the binding is unbuilt and the host cannot build it.
 * @param missing - Names of the build tools that are absent.
 */
function refuseWithoutToolchain(missing) {
	console.error(
		[
			'',
			`✖ node-pty is not built and this host cannot build it: ${missing.join(', ')} missing.`,
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

if (reportOnly) {
	printReport(compiler, linkage);
}

if (!isBuilt) {
	const missing = [
		compiler ? null : 'a C++ compiler',
		resolveCommand('make') ? null : 'make',
		resolveCommand('python3') ? null : 'python3',
	].filter(Boolean);

	if (missing.length > 0) {
		refuseWithoutToolchain(missing);
	}
	process.exit(0);
}

const unportable = linkage ? findUnportableLinks(linkage) : [];

if (unportable.length > 0) {
	refuseUnportableBinding(unportable);
}
