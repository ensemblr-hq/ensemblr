// forge.config.ts signs only when every Apple credential is present, and a
// build that misses one exits 0 with an unsigned .app rather than failing.
// ENSEMBLR_REQUIRE_SIGN closes that at the source; this closes it at the other
// end, on the artifacts themselves, so a release job cannot upload something
// Gatekeeper will refuse on a machine that did not build it.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEVELOPER_ID_AUTHORITY = 'Developer ID Application';

// Forge's architecture names on the left, what `lipo -archs` prints on the
// right. Release legs build one architecture at a time and upload by an
// architecture-anchored pattern, so this script has to verify the same one leg
// rather than whatever is left in `out/`.
const SUPPORTED_ARCHES = new Map([
	['arm64', 'arm64'],
	['x64', 'x86_64'],
]);

// `Authority=Developer ID Application: <Name> (<TEAMID>)` — matching only the
// authority string (above) accepts *any* Developer ID certificate from *any*
// Apple developer account, not just this project's. `ENSEMBLR_TEAM_ID`, set by
// the release and nightly jobs from the `APPLE_TEAM_ID` repository secret, pins
// it to this one. Required: this script only ever runs against artifacts that
// were signed, so an unset Team ID means the pin is not being applied, and a
// pin that silently does nothing is the defect it was added to fix.
const AUTHORITY_LINE_PATTERN =
	/^Authority=Developer ID Application:.*\(([A-Z0-9]{10})\)\s*$/m;

/**
 * Run a command and capture both streams, since `codesign` reports on stderr.
 * @param command - Executable to run
 * @param args - Arguments passed to the executable
 * @returns Whether the command succeeded, and its combined output
 */
function run(command, args) {
	const result = spawnSync(command, args, { encoding: 'utf8' });
	if (result.error) return { ok: false, output: result.error.message };
	const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
	return { ok: result.status === 0, output };
}

/**
 * Read the architecture whose artifacts this run must verify. A release leg
 * builds one architecture at a time, so scanning `out/` for whatever happens to
 * be there would let a leg pass on the other leg's leftovers.
 * @returns The Forge architecture name to verify
 */
function readExpectedArch() {
	const flag = process.argv.find((argument) => argument.startsWith('--arch='));
	const arch = flag ? flag.slice('--arch='.length) : process.arch;
	if (!SUPPORTED_ARCHES.has(arch)) {
		console.error(
			`✖ Unsupported --arch=${arch}. Expected one of: ${[...SUPPORTED_ARCHES.keys()].join(', ')}.`,
		);
		process.exit(1);
	}
	return arch;
}

/**
 * Locate the packaged `.app` bundles for one architecture, whose directory name
 * carries the channel's product name (`Ensemblr.app`, `Ensemblr Canary.app`).
 * @param outDir - Path to the Forge `out/` directory
 * @param arch - Architecture whose package directory to read
 * @returns Absolute paths to every packaged app bundle for that architecture
 */
function findAppBundles(outDir, arch) {
	if (!existsSync(outDir)) return [];
	return readdirSync(outDir, { withFileTypes: true })
		.filter(
			(entry) => entry.isDirectory() && entry.name.endsWith(`-darwin-${arch}`),
		)
		.flatMap((entry) => {
			const packageDir = join(outDir, entry.name);
			return readdirSync(packageDir)
				.filter((name) => name.endsWith('.app'))
				.map((name) => join(packageDir, name));
		});
}

/**
 * Collect the distributables under `out/make` whose path matches an
 * architecture-anchored pattern. The pattern is the same shape the release
 * workflow uses to pick what it uploads, so the two cannot disagree about which
 * file belongs to which leg.
 * @param makeDir - Path to the Forge `out/make/` directory
 * @param pattern - Expression matched against each artifact's full path
 * @returns Absolute paths to the matching artifacts
 */
function findArtifacts(makeDir, pattern) {
	if (!existsSync(makeDir)) return [];
	return readdirSync(makeDir, { withFileTypes: true, recursive: true })
		.filter((entry) => entry.isFile())
		.map((entry) => join(entry.parentPath, entry.name))
		.filter((path) => pattern.test(path));
}

/**
 * Assert a Mach-O file was built for the expected architecture. A DMG that is
 * signed, notarized and stapled says nothing about what is inside it, so an
 * Intel leg that packaged an arm64 binding would pass every other check here.
 * @param binaryPath - Absolute path to a Mach-O executable or `.node` binding
 * @param arch - Architecture the artifact is supposed to be
 * @returns One message when the architecture does not match; empty otherwise
 */
function verifyBinaryArch(binaryPath, arch) {
	const expected = SUPPORTED_ARCHES.get(arch);
	const slices = run('lipo', ['-archs', binaryPath]);
	if (!slices.ok) {
		return [`lipo could not read ${binaryPath}:\n${slices.output}`];
	}
	const found = slices.output.split(/\s+/).filter(Boolean);
	if (!found.includes(expected)) {
		return [
			`${binaryPath} holds [${found.join(', ')}], expected ${expected} (--arch=${arch}).`,
		];
	}
	return [];
}

/**
 * Assert an app bundle's own executable and every native binding it can load
 * were built for the expected architecture. Foreign prebuilds and
 * electron-rebuild's `node-pty/bin` compatibility copies are skipped because
 * node-pty's loader never selects them.
 * @param appPath - Absolute path to the `.app` bundle
 * @param arch - Architecture the bundle is supposed to be
 * @returns One message per failed assertion
 */
export function verifyBundleArch(appPath, arch) {
	const machO = join(appPath, 'Contents', 'MacOS');
	const executables = existsSync(machO)
		? readdirSync(machO).map((name) => join(machO, name))
		: [];
	const unpacked = join(appPath, 'Contents', 'Resources', 'app.asar.unpacked');
	const bindings = existsSync(unpacked)
		? readdirSync(unpacked, { withFileTypes: true, recursive: true })
				.filter((entry) => entry.isFile() && entry.name.endsWith('.node'))
				.map((entry) => join(entry.parentPath, entry.name))
				.filter((path) => {
					if (/\/node_modules\/node-pty\/bin\//.test(path)) return false;
					const prebuild = path.match(/\/prebuilds\/([^/]+)\//);
					return prebuild === null || prebuild[1] === `darwin-${arch}`;
				})
		: [];

	if (executables.length === 0) return [`${appPath} holds no executable.`];
	if (bindings.length === 0) {
		return [
			`${appPath} carries no loadable native binding; node-pty should be packaged, so the terminal would not work in this build.`,
		];
	}

	return [...executables, ...bindings].flatMap((path) =>
		verifyBinaryArch(path, arch),
	);
}

/**
 * Assert an artifact carries a Developer ID Application signature. This is the
 * one assertion that holds whatever the machine's Gatekeeper policy is: once
 * assessments are disabled `spctl` accepts everything, and `stapler validate`
 * passes on a notarized-but-unsigned image — which is how six releases shipped
 * a `.dmg` Gatekeeper refused. Neither can stand alone; this can.
 * @param artifactPath - Absolute path to the `.app` bundle or `.dmg` to inspect
 * @returns One message per failed assertion
 */
function verifyDeveloperIdSignature(artifactPath) {
	const signature = run('codesign', ['-dv', '--verbose=4', artifactPath]);
	if (!signature.ok) {
		return [`codesign could not read a signature:\n${signature.output}`];
	}
	if (!signature.output.includes(DEVELOPER_ID_AUTHORITY)) {
		return [
			`signed by something other than a ${DEVELOPER_ID_AUTHORITY} certificate (ad-hoc or self-signed).`,
		];
	}
	return verifyTeamId(signature.output, artifactPath);
}

/**
 * Assert the signing certificate's Team ID matches `ENSEMBLR_TEAM_ID`.
 * @param codesignOutput - Combined stdout/stderr of `codesign -dv --verbose=4`
 * @param artifactPath - Absolute path to the artifact being checked, for the message
 * @returns One message when the Team ID is unset or does not match; empty otherwise
 */
function verifyTeamId(codesignOutput, artifactPath) {
	const expected = process.env.ENSEMBLR_TEAM_ID;
	if (!expected) {
		return [
			'ENSEMBLR_TEAM_ID is not set, so the signing certificate was accepted from any Apple developer account. CI supplies it from the APPLE_TEAM_ID secret; locally, export it to the Team ID in your Developer ID certificate.',
		];
	}
	const match = codesignOutput.match(AUTHORITY_LINE_PATTERN);
	if (!match) {
		return [
			`ENSEMBLR_TEAM_ID is set but no Developer ID Application authority line with a Team ID was found for ${artifactPath}.`,
		];
	}
	const [, actual] = match;
	if (actual !== expected) {
		return [
			`signed by Team ID ${actual}, expected ${expected} (ENSEMBLR_TEAM_ID).`,
		];
	}
	return [];
}

/**
 * Assert a packaged app is signed by a Developer ID certificate, accepted by
 * Gatekeeper, and carries a stapled notarization ticket.
 * @param appPath - Absolute path to the `.app` bundle
 * @param arch - Architecture the bundle is supposed to be
 * @returns One message per failed assertion
 */
function verifyAppBundle(appPath, arch) {
	const failures = [
		...verifyDeveloperIdSignature(appPath),
		...verifyBundleArch(appPath, arch),
	];
	const integrity = run('codesign', [
		'--verify',
		'--strict',
		'--deep',
		'--verbose=2',
		appPath,
	]);
	if (!integrity.ok)
		failures.push(`codesign --verify failed:\n${integrity.output}`);
	const gatekeeper = run('spctl', ['-a', '-vvv', '-t', 'exec', appPath]);
	if (!gatekeeper.ok)
		failures.push(`spctl rejected the app:\n${gatekeeper.output}`);
	const ticket = run('xcrun', ['stapler', 'validate', appPath]);
	if (!ticket.ok)
		failures.push(`no stapled notarization ticket:\n${ticket.output}`);
	return failures;
}

/**
 * Assert a disk image is signed by a Developer ID certificate, passes
 * Gatekeeper's install policy, and carries its own stapled ticket — all three
 * separately from the app inside it, because the container is its own artifact.
 * @param dmgPath - Absolute path to the `.dmg` artifact
 * @returns One message per failed assertion
 */
function verifyDiskImage(dmgPath) {
	const failures = [...verifyDeveloperIdSignature(dmgPath)];
	const gatekeeper = run('spctl', ['-a', '-vv', '-t', 'install', dmgPath]);
	if (!gatekeeper.ok)
		failures.push(`spctl rejected the disk image:\n${gatekeeper.output}`);
	const ticket = run('xcrun', ['stapler', 'validate', dmgPath]);
	if (!ticket.ok)
		failures.push(`no stapled notarization ticket:\n${ticket.output}`);
	return failures;
}

/**
 * Assert the `.app` a distributable archive actually holds is signed and
 * stapled, rather than trusting that the zip maker captured the bundle already
 * checked under `out/`. The archive is a shipped asset, and it only carries a
 * ticket if the maker ran after notarization — an ordering this script should
 * not have to assume of a third-party maker. `ditto` rather than `unzip`: it is
 * Apple's tool for distribution archives and preserves what a signature needs.
 * @param zipPath - Absolute path to the `.zip` artifact
 * @param arch - Architecture the archived bundle is supposed to be
 * @returns One message per failed assertion
 */
function verifyArchive(zipPath, arch) {
	const extractRoot = mkdtempSync(join(tmpdir(), 'ensemblr-verify-'));
	try {
		const extraction = run('ditto', ['-x', '-k', zipPath, extractRoot]);
		if (!extraction.ok) {
			return [`could not extract the archive:\n${extraction.output}`];
		}
		const bundles = readdirSync(extractRoot)
			.filter((name) => name.endsWith('.app'))
			.map((name) => join(extractRoot, name));
		if (bundles.length === 0) return ['the archive holds no .app bundle.'];
		return bundles.flatMap((bundle) => verifyAppBundle(bundle, arch));
	} finally {
		rmSync(extractRoot, { recursive: true, force: true });
	}
}

/**
 * Label every failure with the artifact it came from, so one flat list names
 * each problem across the whole `out/` tree instead of stopping at the first.
 * @param paths - Absolute artifact paths to check
 * @param verify - Assertion returning one message per failure
 * @returns Every failure, each prefixed with its artifact path
 */
function collectFailures(paths, verify) {
	return paths.flatMap((path) =>
		verify(path).map((failure) => `${path}\n  ${failure}`),
	);
}

/**
 * Verify every artifact a `make` run produced, reporting each failure rather
 * than stopping at the first, and treating an empty `out/` as a failure of its
 * own so a skipped build never reads as a pass.
 * @returns Process exit code: 0 when every artifact verified
 */
function main() {
	const arch = readExpectedArch();
	const repoRoot = fileURLToPath(new URL('..', import.meta.url));
	const outDir = join(repoRoot, 'out');
	const makeDir = join(outDir, 'make');
	const appBundles = findAppBundles(outDir, arch);
	const diskImages = findArtifacts(makeDir, new RegExp(`-${arch}\\.dmg$`));
	const archives = findArtifacts(
		makeDir,
		new RegExp(`/[^/]*-darwin-${arch}-[^/]*\\.zip$`),
	);

	if (
		appBundles.length === 0 ||
		diskImages.length === 0 ||
		archives.length === 0
	) {
		console.error(
			[
				`✖ Nothing to verify for ${arch} — run \`bun run make --arch=${arch}\` first.`,
				'  A release leg that produced no artifact for its own architecture',
				"  must fail here rather than pass on another leg's output.",
				`  .app bundles: ${appBundles.length}`,
				`  .dmg: ${diskImages.length}`,
				`  .zip: ${archives.length}`,
			].join('\n'),
		);
		return 1;
	}

	const problems = [
		...collectFailures(appBundles, (path) => verifyAppBundle(path, arch)),
		...collectFailures(diskImages, verifyDiskImage),
		...collectFailures(archives, (path) => verifyArchive(path, arch)),
	];

	if (problems.length > 0) {
		console.error(`✖ ${problems.length} signing check(s) failed:\n`);
		for (const problem of problems) console.error(`${problem}\n`);
		return 1;
	}

	console.log(
		`✓ Signed, notarized, stapled and ${arch}: ${appBundles.length} app bundle(s), ${diskImages.length} disk image(s), ${archives.length} archive(s).`,
	);
	for (const path of [...appBundles, ...diskImages, ...archives]) {
		console.log(`  ${path}`);
	}
	return 0;
}

// `process.exitCode`, not `process.exit()`: Node's stdout is asynchronous for a
// pipe on macOS, so exiting outright can discard the queued failure detail —
// on the one platform this ever runs on, and exactly when it is needed.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exitCode = main();
}
