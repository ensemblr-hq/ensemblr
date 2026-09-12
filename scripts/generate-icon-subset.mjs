/**
 * Regenerates `src/renderer/lib/workbench/icon-subset.gen.ts` from the
 * `@iconify-json/vscode-icons` and `@iconify-json/logos` collections, keeping
 * only the glyphs `src/renderer` actually draws.
 *
 * The full collections are 11.24 MB of SVG path data for 3,699 icons; the app
 * references ~65. `addCollection` needs the collection object, so a static
 * import puts every byte of that into the entry graph and pays its parse before
 * React's first render. Capturing the referenced subset here at authoring time
 * keeps `<Icon>` offline — an unregistered prefix makes Iconify fetch
 * `api.iconify.design`, which in a desktop app is a blank glyph — without
 * shipping the other 99.3%.
 *
 * Run `node scripts/generate-icon-subset.mjs` after adding an icon reference;
 * `tests/renderer/icon-collections.test.ts` fails on drift, so a 66th icon is a
 * red test rather than a silently missing glyph.
 */

import { spawnSync } from 'node:child_process';
import {
	readdirSync,
	readFileSync,
	realpathSync,
	writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SOURCE_ROOT = join(ROOT, 'src');
const RENDERER_ROOT = join(ROOT, 'src', 'renderer');
const OUTPUT = join(
	ROOT,
	'src',
	'renderer',
	'lib',
	'workbench',
	'icon-subset.gen.ts',
);

/** Prefixed references such as `vscode-icons:file-type-js` or `logos:claude-icon`. */
const PREFIXED_REFERENCE =
	/(?<![\w-])(vscode-icons|logos):([a-z0-9][a-z0-9-]*)/g;

/**
 * Bare vscode-icons names, the shape `file-icons.ts` stores in its lookup
 * tables and interpolates into a prefixed template. The four families below are
 * the whole naming scheme of that collection, so a new table entry is picked up
 * without touching this script. Matching is quote-agnostic because the names
 * appear in string literals, template interpolations and JSDoc examples alike;
 * a name that matches but does not exist throws rather than being dropped.
 *
 * Scanned over `src/renderer` only, and never over a `.gen.ts`: lucide ships
 * its own `file-type-2`, and `src/shared/tool-presentation/lucide-icon-names.gen.ts`
 * lists every one of its names.
 */
const BARE_VSCODE_REFERENCE =
	/(?<![\w-])(file-type-[a-z0-9-]+|folder-type-[a-z0-9-]+|default-file|default-folder)(?![\w-])/g;

/** Suffix vscode-icons uses for the expanded variant of a folder glyph. */
const OPENED_SUFFIX = '-opened';

/**
 * Loads a bundled Iconify collection as plain JSON.
 * @param packageName - The `@iconify-json/*` package to read
 * @returns The parsed `icons.json`
 */
function readCollection(packageName) {
	return JSON.parse(
		readFileSync(
			fileURLToPath(import.meta.resolve(`${packageName}/icons.json`)),
			'utf8',
		),
	);
}

const COLLECTIONS = {
	logos: readCollection('@iconify-json/logos'),
	'vscode-icons': readCollection('@iconify-json/vscode-icons'),
};

/**
 * Lists the TypeScript source files under a root, skipping generated modules.
 * @param root - Directory to walk
 * @returns Absolute paths to the hand-written `.ts`/`.tsx` files beneath it
 */
function listSourceFiles(root) {
	return readdirSync(root, { recursive: true, withFileTypes: true })
		.filter(
			(entry) =>
				entry.isFile() &&
				/\.tsx?$/.test(entry.name) &&
				!entry.name.endsWith('.gen.ts'),
		)
		.map((entry) => join(entry.parentPath, entry.name));
}

/**
 * Scans `src/` for every glyph the renderer can ask for, in both the prefixed
 * form and the bare form `file-icons.ts` stores in its tables.
 * @returns Referenced names per collection prefix
 */
export function collectReferencedIconNames() {
	const referenced = { logos: new Set(), 'vscode-icons': new Set() };

	for (const filePath of listSourceFiles(SOURCE_ROOT)) {
		for (const match of readFileSync(filePath, 'utf8').matchAll(
			PREFIXED_REFERENCE,
		)) {
			referenced[match[1]].add(match[2]);
		}
	}

	for (const filePath of listSourceFiles(RENDERER_ROOT)) {
		for (const match of readFileSync(filePath, 'utf8').matchAll(
			BARE_VSCODE_REFERENCE,
		)) {
			referenced['vscode-icons'].add(match[1]);
		}
	}

	return referenced;
}

/**
 * Adds the expanded variant of every referenced folder glyph, which
 * `file-icons.ts` derives at runtime rather than naming in a table.
 * @param names - Referenced vscode-icons names
 * @returns The same names plus every `-opened` variant the collection defines
 */
function withOpenedFolderVariants(names) {
	const collection = COLLECTIONS['vscode-icons'];
	const expanded = new Set(names);

	for (const name of names) {
		const opened = `${name}${OPENED_SUFFIX}`;
		if (collection.icons[opened] ?? collection.aliases?.[opened]) {
			expanded.add(opened);
		}
	}

	return expanded;
}

/**
 * Copies one glyph out of a full collection into the subset, following an
 * alias to its parent so the alias keeps resolving without the other 1,588
 * icons alongside it.
 * @param collection - The full bundled collection
 * @param name - The glyph name to copy
 * @param subset - The subset being built, mutated in place
 * @throws When the name resolves in neither `icons` nor `aliases`
 */
function copyIcon(collection, name, subset) {
	const icon = collection.icons[name];

	if (icon) {
		subset.icons[name] = icon;
		return;
	}

	const alias = collection.aliases?.[name];

	if (!alias) {
		throw new Error(
			`${collection.prefix}:${name} is referenced in src/ but absent from the bundled collection`,
		);
	}

	subset.aliases[name] = alias;
	copyIcon(collection, alias.parent, subset);
}

/**
 * Builds the trimmed collections the renderer registers.
 * @returns One Iconify collection object per bundled prefix, carrying only the
 *   referenced glyphs and the aliases needed to resolve them
 */
export function buildIconSubset() {
	const referenced = collectReferencedIconNames();
	const subsets = {};

	for (const [prefix, collection] of Object.entries(COLLECTIONS)) {
		const names =
			prefix === 'vscode-icons'
				? withOpenedFolderVariants(referenced[prefix])
				: referenced[prefix];
		const subset = {
			prefix: collection.prefix,
			icons: {},
			aliases: {},
			width: collection.width,
			height: collection.height,
		};

		for (const name of [...names].sort()) {
			copyIcon(collection, name, subset);
		}

		subsets[prefix] = subset;
	}

	return subsets;
}

/**
 * Renders the subset as the generated TypeScript module.
 * @param subsets - Trimmed collections keyed by prefix
 * @returns Source text for `icon-subset.gen.ts`
 */
function renderModule(subsets) {
	const entries = Object.entries(subsets)
		.map(
			([prefix, subset]) =>
				`\t${JSON.stringify(prefix)}: ${JSON.stringify(subset)},`,
		)
		.join('\n');

	return `// Generated by scripts/generate-icon-subset.mjs — run \`node scripts/generate-icon-subset.mjs\`.
// Do not edit by hand; tests/renderer/icon-collections.test.ts fails on drift.

import type { IconifyJSON } from '@iconify/react';

/**
 * The glyphs \`src/renderer\` draws, lifted out of \`@iconify-json/vscode-icons\`
 * and \`@iconify-json/logos\` so the entry bundle carries ~80 KB of icon data
 * instead of the 11.24 MB both full collections weigh.
 */
export const ICON_SUBSET = {
${entries}
} satisfies Record<string, IconifyJSON>;
`;
}

/**
 * Formats the written module in place.
 *
 * `JSON.stringify` emits double quotes and quoted keys where house style is
 * single quotes and bare keys, so without this pass a regeneration and
 * `biome check` rewrite each other on every run — the same reason
 * `credits:generate` and `i18n:extract` are each chased with a formatter.
 */
function formatOutput() {
	spawnSync('npx', ['biome', 'check', '--write', OUTPUT], {
		cwd: ROOT,
		stdio: 'inherit',
	});
}

/**
 * Writes the generated module to disk.
 * @returns How many glyphs were written, per prefix
 */
export function writeIconSubset() {
	const subsets = buildIconSubset();
	writeFileSync(OUTPUT, renderModule(subsets), 'utf8');
	formatOutput();

	return Object.fromEntries(
		Object.entries(subsets).map(([prefix, subset]) => [
			prefix,
			Object.keys(subset.icons).length + Object.keys(subset.aliases).length,
		]),
	);
}

/**
 * Whether `node scripts/generate-icon-subset.mjs` started this process, as
 * opposed to a test importing `buildIconSubset` to recompute the subset. Both
 * sides are realpath-resolved so a symlinked checkout does not skip the write.
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
	const written = writeIconSubset();
	process.stdout.write(
		`Wrote ${Object.entries(written)
			.map(([prefix, count]) => `${count} ${prefix}`)
			.join(', ')} glyphs to src/renderer/lib/workbench/icon-subset.gen.ts\n`,
	);
}
