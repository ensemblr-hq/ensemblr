// Type-check every TypeScript project concurrently.
//
// The four projects each `include` `src`, so chaining them with `&&` re-checks
// the bulk of the program four times in a row. They are independent, so running
// them at once collapses four serial passes into one wall-clock pass. Output is
// buffered per project and flushed on completion, because four interleaved tsc
// streams are unreadable.

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));

const PROJECTS = [
	{ label: 'app', project: 'tsconfig.json' },
	{ label: 'scripts', project: 'tsconfig.scripts.json' },
	{ label: 'tests', project: 'tsconfig.tests.json' },
	{ label: 'demo', project: 'tsconfig.demo.json' },
];

/**
 * Resolve the locally installed `tsc` binary.
 * @returns Absolute path to the `tsc` executable.
 */
function resolveTypescriptBinary() {
	const binary = path.join(repositoryRoot, 'node_modules', '.bin', 'tsc');
	if (!existsSync(binary)) {
		throw new Error(
			`typecheck: ${binary} is missing. Run \`npm ci\` before type-checking.`,
		);
	}
	return binary;
}

/**
 * Run `tsc --noEmit` for one project, capturing its output rather than
 * interleaving it with the other projects running alongside.
 * @param binary - Absolute path to the `tsc` executable
 * @param entry - The project's label and tsconfig path
 * @returns The project's label, exit code, and captured output
 */
function checkProject(binary, entry) {
	return new Promise((resolve) => {
		const child = spawn(binary, ['--noEmit', '-p', entry.project], {
			cwd: repositoryRoot,
			stdio: ['ignore', 'pipe', 'pipe'],
		});

		let output = '';
		child.stdout.on('data', (chunk) => {
			output += chunk;
		});
		child.stderr.on('data', (chunk) => {
			output += chunk;
		});

		child.on('error', (error) => {
			resolve({ ...entry, code: 1, output: `${error.message}\n` });
		});
		child.on('close', (code) => {
			resolve({ ...entry, code: code ?? 1, output });
		});
	});
}

/**
 * Type-check all projects concurrently and exit non-zero if any of them failed.
 */
async function main() {
	const binary = resolveTypescriptBinary();
	const results = await Promise.all(
		PROJECTS.map((entry) => checkProject(binary, entry)),
	);

	const failed = results.filter((result) => result.code !== 0);
	for (const result of failed) {
		process.stdout.write(`\n--- typecheck: ${result.label} failed ---\n`);
		process.stdout.write(result.output);
	}

	if (failed.length > 0) {
		const labels = failed.map((result) => result.label).join(', ');
		process.stdout.write(`\ntypecheck: ${labels} failed.\n`);
		process.exitCode = 1;
		return;
	}

	const labels = results.map((result) => result.label).join(', ');
	process.stdout.write(`typecheck: ${labels} passed.\n`);
}

main().catch((error) => {
	process.stderr.write(`${error.message}\n`);
	process.exitCode = 1;
});
