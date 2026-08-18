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
 * Locate the packaged `.app` bundles, whose directory name carries the
 * channel's product name (`Ensemblr.app`, `Ensemblr Canary.app`).
 * @param outDir - Path to the Forge `out/` directory
 * @returns Absolute paths to every packaged app bundle
 */
function findAppBundles(outDir) {
	if (!existsSync(outDir)) return [];
	return readdirSync(outDir, { withFileTypes: true })
		.filter(
			(entry) => entry.isDirectory() && entry.name.endsWith('-darwin-arm64'),
		)
		.flatMap((entry) => {
			const packageDir = join(outDir, entry.name);
			return readdirSync(packageDir)
				.filter((name) => name.endsWith('.app'))
				.map((name) => join(packageDir, name));
		});
}

/**
 * Collect every distributable under `out/make` carrying the given extension.
 * @param makeDir - Path to the Forge `out/make/` directory
 * @param extension - File extension to match, including the leading dot
 * @returns Absolute paths to the matching artifacts
 */
function findArtifacts(makeDir, extension) {
	if (!existsSync(makeDir)) return [];
	return readdirSync(makeDir, { withFileTypes: true, recursive: true })
		.filter((entry) => entry.isFile() && entry.name.endsWith(extension))
		.map((entry) => join(entry.parentPath, entry.name));
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
	return [];
}

/**
 * Assert a packaged app is signed by a Developer ID certificate, accepted by
 * Gatekeeper, and carries a stapled notarization ticket.
 * @param appPath - Absolute path to the `.app` bundle
 * @returns One message per failed assertion
 */
function verifyAppBundle(appPath) {
	const failures = [...verifyDeveloperIdSignature(appPath)];
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
 * @returns One message per failed assertion
 */
function verifyArchive(zipPath) {
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
		return bundles.flatMap((bundle) => verifyAppBundle(bundle));
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
	const repoRoot = fileURLToPath(new URL('..', import.meta.url));
	const outDir = join(repoRoot, 'out');
	const makeDir = join(outDir, 'make');
	const appBundles = findAppBundles(outDir);
	const diskImages = findArtifacts(makeDir, '.dmg');
	const archives = findArtifacts(makeDir, '.zip');

	if (
		appBundles.length === 0 ||
		diskImages.length === 0 ||
		archives.length === 0
	) {
		console.error(
			[
				'✖ Nothing to verify — run `npm run make` first.',
				`  .app bundles: ${appBundles.length}`,
				`  .dmg: ${diskImages.length}`,
				`  .zip: ${archives.length}`,
			].join('\n'),
		);
		return 1;
	}

	const problems = [
		...collectFailures(appBundles, verifyAppBundle),
		...collectFailures(diskImages, verifyDiskImage),
		...collectFailures(archives, verifyArchive),
	];

	if (problems.length > 0) {
		console.error(`✖ ${problems.length} signing check(s) failed:\n`);
		for (const problem of problems) console.error(`${problem}\n`);
		return 1;
	}

	console.log(
		`✓ Signed, notarized and stapled: ${appBundles.length} app bundle(s), ${diskImages.length} disk image(s), ${archives.length} archive(s).`,
	);
	for (const path of [...appBundles, ...diskImages, ...archives]) {
		console.log(`  ${path}`);
	}
	return 0;
}

// `process.exitCode`, not `process.exit()`: Node's stdout is asynchronous for a
// pipe on macOS, so exiting outright can discard the queued failure detail —
// on the one platform this ever runs on, and exactly when it is needed.
process.exitCode = main();
