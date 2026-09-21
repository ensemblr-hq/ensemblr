// `@reforged/maker-appimage` defaults its runtime to
// https://github.com/AppImage/type2-runtime/releases/download/continuous/runtime-<arch>
// and accepts whatever comes back on an HTTP 200, despite a comment in its
// types claiming the download is checksum-verified. `continuous` is a mutable
// tag, so that is an unreviewed third-party binary prepended to every AppImage
// this project ships. Fetch it here instead, against a pinned digest, the way
// scripts/rebuild-native-linux.sh pins its container image — and let
// forge.config.ts hand the maker the verified local file.
//
// Refresh a runtime by downloading it, checking what changed upstream, and
// updating the digest below in the same commit.
import { createHash } from 'node:crypto';
import {
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RUNTIME_TAG = 'continuous';
const RUNTIME_MIRROR =
	'https://github.com/AppImage/type2-runtime/releases/download';

// Forge architecture → the AppImage runtime name and its pinned SHA-256, plus
// the ELF `e_machine` the downloaded file must declare. The digest alone proves
// the bytes; the machine check names the failure when a mirror serves the wrong
// architecture under the right name.
const RUNTIMES = new Map([
	[
		'x64',
		{
			name: 'x86_64',
			sha256:
				'1cc49bcf1e2ccd593c379adb17c9f85a36d619088296504de95b1d06215aebbf',
			machine: 0x3e,
		},
	],
	[
		'arm64',
		{
			name: 'aarch64',
			sha256:
				'7d5d772b7c32f0c84caf0a452a3072a5709027d7eac5856feb89a7a7a8881372',
			machine: 0xb7,
		},
	],
]);

/**
 * Reads the target architecture. `bun run make:linux --arch=…` appends its
 * arguments to the last command in the `&&` chain, which is Forge rather than
 * this preflight, so a cross-build has to name the target through the
 * environment instead.
 * @returns The Forge architecture name to fetch a runtime for
 */
function readArch() {
	const flag = process.argv.find((argument) => argument.startsWith('--arch='));
	if (flag) return flag.slice('--arch='.length);
	return process.env.ENSEMBLR_TARGET_ARCH || process.arch;
}

/**
 * Absolute path the verified runtime for an architecture is cached at.
 * @param appImageArch - The AppImage architecture name, such as `x86_64`
 * @returns Absolute path to the cached runtime binary
 */
function appImageRuntimePath(appImageArch) {
	const repoRoot = fileURLToPath(new URL('..', import.meta.url));
	return join(repoRoot, '.appimage-runtime', `runtime-${appImageArch}`);
}

/**
 * Records the runtime this run verified, so forge.config.ts hands the maker the
 * exact file rather than re-deriving the target architecture from argv and
 * risking the two disagreeing. Written immediately before Forge runs, since
 * both are links in one `&&` chain.
 * @param runtimePath - Absolute path to the verified runtime binary
 */
function recordResolvedRuntime(runtimePath) {
	const manifest = join(dirname(runtimePath), 'resolved.json');
	mkdirSync(dirname(manifest), { recursive: true });
	writeFileSync(manifest, `${JSON.stringify({ runtime: runtimePath })}\n`);
}

/**
 * Asserts a downloaded runtime matches its pinned digest and declares the
 * expected ELF machine.
 * @param bytes - The downloaded runtime
 * @param runtime - The pinned expectations for this architecture
 * @returns A failure message, or null when the runtime is what it should be
 */
function describeMismatch(bytes, runtime) {
	const digest = createHash('sha256').update(bytes).digest('hex');
	if (digest !== runtime.sha256) {
		return `expected sha256 ${runtime.sha256}, got ${digest}. The mutable '${RUNTIME_TAG}' tag has moved; review the change upstream before updating the pin.`;
	}
	if (bytes.subarray(0, 4).toString('latin1') !== '\x7fELF') {
		return 'the download is not an ELF binary.';
	}
	const machine = bytes.readUInt16LE(18);
	if (machine !== runtime.machine) {
		return `ELF machine is 0x${machine.toString(16)}, expected 0x${runtime.machine.toString(16)}.`;
	}
	return null;
}

/**
 * Downloads and verifies the AppImage runtime for the requested architecture,
 * skipping the network when a verified copy is already cached.
 * @param options - Optional target, cache path, downloader, and runtime pins
 * @returns Process exit code: 0 when a verified runtime is in place
 */
export async function main({
	arch = readArch(),
	destination: destinationOverride,
	download = fetch,
	resolveDestination = appImageRuntimePath,
	runtimes = RUNTIMES,
} = {}) {
	const runtime = runtimes.get(arch);

	if (!runtime) {
		console.error(
			`✖ No pinned AppImage runtime for --arch=${arch}. Known: ${[...runtimes.keys()].join(', ')}.`,
		);
		return 1;
	}

	const destination = destinationOverride ?? resolveDestination(runtime.name);

	if (existsSync(destination)) {
		const problem = describeMismatch(readFileSync(destination), runtime);
		if (!problem) {
			recordResolvedRuntime(destination);
			return 0;
		}
		rmSync(destination, { force: true });
	}

	const url = `${RUNTIME_MIRROR}/${RUNTIME_TAG}/runtime-${runtime.name}`;
	const response = await download(url);

	if (!response.ok) {
		console.error(`✖ ${url} returned HTTP ${response.status}.`);
		return 1;
	}

	const bytes = Buffer.from(await response.arrayBuffer());
	const problem = describeMismatch(bytes, runtime);

	if (problem) {
		console.error(`✖ AppImage runtime for ${arch} failed verification.`);
		console.error(`  ${url}`);
		console.error(`  ${problem}`);
		return 1;
	}

	mkdirSync(join(destination, '..'), { recursive: true });
	writeFileSync(destination, bytes, { mode: 0o755 });
	recordResolvedRuntime(destination);
	console.log(`✓ Verified AppImage runtime for ${arch}: ${destination}`);
	return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exitCode = await main();
}
