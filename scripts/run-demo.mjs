#!/usr/bin/env node
/**
 * Launcher for Ensemblr demo mode.
 *
 * Three moving parts, in order: build the demo window's Electron main and
 * preload bundles, start a Vite dev server for the demo renderer, then launch
 * Electron against both. The renderer is served rather than bundled so editing a
 * scenario file repaints the running window over HMR.
 *
 * Nothing here touches the shipped app: the demo window is its own Electron
 * entrypoint with its own `userData`, and `electron-forge` is not involved.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { build, createServer } from 'vite';

const repositoryRoot = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	'..',
);

/**
 * Builds the demo main and preload bundles.
 * @param watch - Whether to keep rebuilding as the sources change.
 */
async function buildDemoMain(watch) {
	await build({
		build: { watch: watch ? {} : null },
		configFile: path.join(repositoryRoot, 'vite.demo-main.config.mts'),
		logLevel: 'warn',
		root: repositoryRoot,
	});
}

/**
 * Reads a `--name=value` command-line flag.
 * @param name - Flag to read, including its leading dashes.
 * @returns The value, or null when the flag was not passed.
 */
function readFlag(name) {
	const match = process.argv.find((argument) =>
		argument.startsWith(`${name}=`),
	);
	return match ? match.slice(name.length + 1) : null;
}

/**
 * Starts the demo renderer's dev server.
 * @returns The server and the URL it is listening on.
 */
async function startRenderer() {
	const server = await createServer({
		configFile: path.join(repositoryRoot, 'vite.demo.config.mts'),
		root: repositoryRoot,
	});
	await server.listen();
	const url = server.resolvedUrls?.local?.[0];
	if (!url) {
		throw new Error('Demo renderer dev server reported no local URL.');
	}
	const entry = new URL('demo/', url);
	const scenario = readFlag('--scenario');
	if (scenario) {
		entry.searchParams.set('scenario', scenario);
	}
	const step = readFlag('--step');
	if (step) {
		entry.searchParams.set('step', step);
	}
	return { server, url: entry.toString() };
}

/**
 * Launches Electron against the built main bundle.
 * @param url - Dev-server URL the demo window loads.
 * @returns The Electron child process.
 */
async function launchElectron(url) {
	const { default: electronBinary } = await import('electron');
	return spawn(
		electronBinary,
		[path.join(repositoryRoot, '.demo/demo-main.js')],
		{
			cwd: repositoryRoot,
			env: {
				...process.env,
				ENSEMBLR_DEMO_URL: url,
				...(shootScenario ? { ENSEMBLR_DEMO_SHOOT: shootScenario } : {}),
			},
			stdio: 'inherit',
		},
	);
}

const shootScenario = process.argv.includes('--shoot')
	? (readFlag('--scenario') ?? 'demo')
	: null;
const shouldWatch = !shootScenario && !process.argv.includes('--no-watch');

await buildDemoMain(false);
if (shouldWatch) {
	void buildDemoMain(true);
}

const { server, url } = await startRenderer();
const electron = await launchElectron(url);

process.stdout.write(`Ensemblr demo renderer: ${url}\n`);

electron.on('exit', (code) => {
	void server.close().then(() => process.exit(code ?? 0));
});
