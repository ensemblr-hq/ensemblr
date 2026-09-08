import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { resolvePiSlashCommands } from '../../src/main/pi-agent/pi-slash-commands.ts';
import type { PiExecutableSnapshot } from '../../src/main/pi-runtime/pi-executable.ts';

const temporaryDirectories: string[] = [];

/** Creates a temporary directory and records it for cleanup. */
function createTemporaryDirectory(): string {
	const directory = mkdtempSync(path.join(tmpdir(), 'ensemblr-pi-slash-'));
	temporaryDirectories.push(directory);
	return directory;
}

/** Writes the minimal Pi SDK surface needed by slash-command discovery. */
function writeFakePiSdk(packageRoot: string): void {
	mkdirSync(path.join(packageRoot, 'dist'), { recursive: true });
	writeFileSync(
		path.join(packageRoot, 'package.json'),
		JSON.stringify({ name: '@earendil-works/pi-coding-agent', type: 'module' }),
	);
	writeFileSync(
		path.join(packageRoot, 'dist', 'index.js'),
		`export const SettingsManager = { create: () => ({}) };
export class DefaultResourceLoader { async reload() {} }
export const SessionManager = { inMemory: () => ({}) };
export const AuthStorage = { create: () => ({}) };
export const ModelRegistry = { create: () => ({}) };
export const getAgentDir = () => '/tmp/pi-agent';
export const createAgentSession = () => ({
  session: {
    async bindExtensions() {},
    _extensionRunner: {
      runtime: {
        getCommands: () => [
          {
            name: 'extension-command',
            description: 'Extension command',
            source: 'extension',
            sourceInfo: { scope: 'user' },
          },
          {
            name: 'skill:example',
            description: 'Example skill',
            source: 'skill',
            sourceInfo: { scope: 'project' },
          },
        ],
      },
    },
    dispose() {},
  },
});
`,
	);
}

/** Builds a ready executable snapshot for the resolver. */
function executableSnapshot(command: string): PiExecutableSnapshot {
	return {
		command,
		diagnostics: [],
		displayPath: command,
		path: command,
		probe: null,
		setting: null,
		source: 'path',
		status: 'ok',
		updatedAt: new Date(0).toISOString(),
	};
}

afterEach(() => {
	for (const directory of temporaryDirectories.splice(0)) {
		rmSync(directory, { force: true, recursive: true });
	}
});

describe('Pi slash command discovery', () => {
	it('loads skills and extensions when Homebrew exposes Pi through its prefix wrapper', async () => {
		const prefix = createTemporaryDirectory();
		const executable = path.join(prefix, 'bin', 'pi');
		const packageRoot = path.join(
			prefix,
			'libexec',
			'lib',
			'node_modules',
			'@earendil-works',
			'pi-coding-agent',
		);
		mkdirSync(path.dirname(executable), { recursive: true });
		writeFileSync(executable, '#!/bin/sh\n');
		writeFakePiSdk(packageRoot);

		const result = await resolvePiSlashCommands(
			executableSnapshot(executable),
			prefix,
		);

		expect(result).toEqual({
			commands: [
				{
					autoSubmit: false,
					command: 'extension-command',
					description: 'Extension command',
					source: 'extension',
					sourceScope: 'user',
				},
				{
					autoSubmit: false,
					command: 'skill:example',
					description: 'Example skill',
					source: 'skill',
					sourceScope: 'project',
				},
			],
			error: null,
			source: 'runtime',
		});
	});
});
