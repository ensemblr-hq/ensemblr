/**
 * Regenerates `src/main/menu/credits-manifest.gen.ts` from the direct
 * dependencies declared in the root `package.json`.
 *
 * The name, license, and project URL of a dependency live in that dependency's
 * own `package.json`, which the packaged app does not ship — Vite bundles the
 * code and Forge drops `node_modules` apart from the `PACKAGE_KEEP_*` entries.
 * So the About panel's credits are captured here at authoring time into a
 * committed file rather than read at runtime.
 *
 * Run `npm run credits:generate` after any dependency change;
 * `tests/main/credits-manifest.test.ts` fails on drift.
 */

import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUTPUT = join(ROOT, 'src', 'main', 'menu', 'credits-manifest.gen.ts');

/** npm's marker for a package that grants no license at all. */
const UNLICENSED = 'UNLICENSED';

/** What the panel shows for a package whose terms live in a file rather than an SPDX id. */
const CUSTOM_LICENSE = 'Custom license';

/** npm's spelling for bespoke terms, in both the American and British forms it accepts. */
const TERMS_IN_FILE = /^SEE LICEN[CS]E IN /i;

/**
 * Reads and parses a package manifest from disk.
 * @param path - Absolute path to a `package.json`
 * @returns The parsed manifest
 */
function readManifest(path) {
	return JSON.parse(readFileSync(path, 'utf8'));
}

/**
 * Resolves a dependency's SPDX license expression across the three shapes npm
 * has accepted over time: the modern `license` string, the legacy `license`
 * object, and the even older `licenses` array.
 * @param manifest - The dependency's parsed `package.json`
 * @returns The license expression, or null when the manifest declares none
 */
function readLicense(manifest) {
	if (typeof manifest.license === 'string') return manifest.license;
	if (manifest.license?.type) return manifest.license.type;
	if (Array.isArray(manifest.licenses)) {
		const types = manifest.licenses.map((entry) => entry.type).filter(Boolean);
		if (types.length > 0) return types.join(' OR ');
	}
	return null;
}

/**
 * Turns a declared license into something that reads as a license beside the
 * SPDX identifiers filling the rest of the column. npm accepts
 * `SEE LICENSE IN <file>` for bespoke terms, which is an instruction rather
 * than a name and reads as a rendering bug next to `MIT`; the entry's URL
 * already points at the repository holding the file it names.
 * @param declared - The manifest's declared license expression
 * @returns A display label, or null when the manifest declares nothing usable
 */
function displayLicense(declared) {
	if (!declared) return null;
	return TERMS_IN_FILE.test(declared) ? CUSTOM_LICENSE : declared;
}

/**
 * Turns any of npm's repository shorthands into a browsable https URL.
 * @param repository - The manifest's `repository` field
 * @returns An https URL, or null when the field is absent or unrecognised
 */
function repositoryUrl(repository) {
	const raw = typeof repository === 'string' ? repository : repository?.url;
	if (!raw) return null;

	const stripped = raw.replace(/^git\+/, '').replace(/\.git$/, '');
	if (stripped.startsWith('https://')) return stripped;
	if (stripped.startsWith('git://'))
		return stripped.replace(/^git:\/\//, 'https://');
	if (stripped.startsWith('http://'))
		return stripped.replace(/^http:\/\//, 'https://');
	if (/^[\w-]+\/[\w.-]+$/.test(stripped))
		return `https://github.com/${stripped}`;
	return null;
}

/**
 * Resolves the project page to link a dependency to, preferring its declared
 * homepage over its repository.
 * @param manifest - The dependency's parsed `package.json`
 * @returns A URL, or null when the manifest declares neither
 */
function readUrl(manifest) {
	if (typeof manifest.homepage === 'string' && manifest.homepage.length > 0) {
		return manifest.homepage;
	}
	return repositoryUrl(manifest.repository);
}

/**
 * Collects the credit entries for one dependency group.
 * @param names - Package names declared in that group
 * @param kind - Which group the entries belong to
 * @returns Credit entries sorted by package name
 */
function collect(names, kind) {
	return names
		.slice()
		.sort()
		.map((name) => {
			const manifest = readManifest(
				join(ROOT, 'node_modules', name, 'package.json'),
			);
			const license = displayLicense(readLicense(manifest));
			const url = readUrl(manifest);
			if (!license) throw new Error(`${name} declares no license`);
			if (license === UNLICENSED)
				throw new Error(`${name} is UNLICENSED and cannot be redistributed`);
			if (!url) throw new Error(`${name} declares no homepage or repository`);
			return { name, license, url, kind };
		});
}

/**
 * Builds the full credits manifest from the root `package.json`.
 * @returns Every direct dependency, runtime group first
 */
export function buildCreditsManifest() {
	const root = readManifest(join(ROOT, 'package.json'));
	return [
		...collect(Object.keys(root.dependencies ?? {}), 'runtime'),
		...collect(Object.keys(root.devDependencies ?? {}), 'development'),
	];
}

/**
 * Renders the manifest as the generated TypeScript module.
 * @param packages - Credit entries to serialize
 * @returns Source text for `credits-manifest.gen.ts`
 */
function renderModule(packages) {
	const entries = packages
		.map(
			({ name, license, url, kind }) =>
				`\t{ name: ${JSON.stringify(name)}, license: ${JSON.stringify(license)}, url: ${JSON.stringify(url)}, kind: ${JSON.stringify(kind)} },`,
		)
		.join('\n');

	return `// Generated by scripts/generate-credits.mjs — run \`npm run credits:generate\`.
// Do not edit by hand; tests/main/credits-manifest.test.ts fails on drift.

import type { CreditPackage } from './credits';

/** Every direct dependency of Ensemblr, credited in the native About panel. */
export const CREDITS_PACKAGES = [
${entries}
] as const satisfies readonly CreditPackage[];
`;
}

/**
 * Writes the generated module to disk.
 * @returns How many credit entries were written
 */
export function writeCreditsManifest() {
	const packages = buildCreditsManifest();
	writeFileSync(OUTPUT, renderModule(packages), 'utf8');
	return packages.length;
}

/**
 * Whether `node scripts/generate-credits.mjs` started this process, as opposed
 * to a test importing `buildCreditsManifest` to recompute the manifest.
 *
 * Both sides are realpath-resolved: the ESM loader resolves `import.meta.url`
 * through the real path while `process.argv[1]` keeps whatever the command
 * line said, so comparing them raw makes a symlinked checkout skip the write
 * and exit 0 having done nothing.
 * @returns True when this module is the process entrypoint
 */
function isEntrypoint() {
	const invoked = process.argv[1];
	if (!invoked) return false;
	try {
		return realpathSync(invoked) === fileURLToPath(import.meta.url);
	} catch {
		return false;
	}
}

if (isEntrypoint()) {
	process.stdout.write(
		`Wrote ${writeCreditsManifest()} credit entries to src/main/menu/credits-manifest.gen.ts\n`,
	);
}
