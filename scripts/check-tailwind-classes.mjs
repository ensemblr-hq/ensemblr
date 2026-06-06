import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const roots = ['src/renderer'];
const extensions = new Set(['.css', '.js', '.jsx', '.ts', '.tsx']);

const canonicalClasses = new Map([
	['text-[0.75rem]', 'text-xs'],
	['rounded-[0.375rem]', 'rounded-2xl'],
	['rounded-[0.125rem]', 'rounded-sm'],
]);

const pixelArbitraryPattern = /\[[^\]]*px[^\]]*\]/g;

async function* walk(directory) {
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		const fullPath = path.join(directory, entry.name);

		if (entry.isDirectory()) {
			yield* walk(fullPath);
			continue;
		}

		if (entry.isFile() && extensions.has(path.extname(entry.name))) {
			yield fullPath;
		}
	}
}

function lineAndColumn(source, index) {
	const prefix = source.slice(0, index);
	const lines = prefix.split('\n');

	return {
		column: lines.at(-1).length + 1,
		line: lines.length,
	};
}

function addFinding(findings, filePath, source, index, message) {
	const location = lineAndColumn(source, index);

	findings.push({
		column: location.column,
		filePath,
		line: location.line,
		message,
	});
}

const findings = [];

for (const root of roots) {
	for await (const filePath of walk(root)) {
		const source = await readFile(filePath, 'utf8');

		for (const match of source.matchAll(pixelArbitraryPattern)) {
			addFinding(
				findings,
				filePath,
				source,
				match.index,
				`Avoid square-bracket pixel utility \`${match[0]}\`; use a Tailwind scale class or rem-based arbitrary value.`,
			);
		}

		for (const [arbitraryClass, canonicalClass] of canonicalClasses) {
			let index = source.indexOf(arbitraryClass);

			while (index !== -1) {
				addFinding(
					findings,
					filePath,
					source,
					index,
					`Use canonical Tailwind class \`${canonicalClass}\` instead of \`${arbitraryClass}\`.`,
				);
				index = source.indexOf(arbitraryClass, index + arbitraryClass.length);
			}
		}
	}
}

if (findings.length > 0) {
	console.error('Tailwind class policy violations found:\n');

	for (const finding of findings) {
		console.error(
			`${finding.filePath}:${finding.line}:${finding.column} - ${finding.message}`,
		);
	}

	process.exit(1);
}
