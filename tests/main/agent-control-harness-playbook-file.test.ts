import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
	BrowserWindow: { getFocusedWindow: () => null },
	dialog: { showMessageBox: vi.fn() },
}));

import { HARNESS_INSTRUCTIONS_FILENAME } from '../../src/main/agent-control/harness-launch-config.ts';
import {
	createAgentControlIntegration,
	createOriginRegistry,
} from '../../src/main/agent-control/index.ts';
import {
	buildLanguageDirective,
	HARNESS_AWARENESS,
} from '../../src/shared/agent-control.ts';
import type { AppLanguage } from '../../src/shared/i18n.ts';

const WORKSPACE = 'ws-1';
const SERVER_URL = 'http://127.0.0.1:4321';

const userDataDirectories: string[] = [];

/**
 * Wires the real integration against a throwaway `userData` directory and
 * returns the playbook file it writes, so the assertions read the bytes a
 * harness actually loads rather than the flag that points at them.
 * @param language - The language the app reports while the harness launches.
 * @returns The launch command's decoration and the playbook file's contents.
 */
const launchHarness = (language: AppLanguage) => {
	const userData = mkdtempSync(path.join(tmpdir(), 'ensemblr-harness-'));
	userDataDirectories.push(userData);
	const { augmentHarnessCommand } = createAgentControlIntegration({
		app: {
			isPackaged: false,
			getAppPath: () => process.cwd(),
			getPath: () => userData,
		} as never,
		getLanguage: () => language,
		getServerUrl: () => SERVER_URL,
		originRegistry: createOriginRegistry({ generateToken: () => 'tok' }),
		resolveWorkspaceCwd: () => '/tmp/ws-1',
	});

	const command = augmentHarnessCommand('claude', 'claude', WORKSPACE);
	return {
		command,
		playbook: readFileSync(
			path.join(
				userData,
				'harness-instructions',
				HARNESS_INSTRUCTIONS_FILENAME,
			),
			'utf8',
		),
	};
};

afterEach(() => {
	for (const directory of userDataDirectories.splice(0)) {
		rmSync(directory, { force: true, recursive: true });
	}
});

// This file is the only channel Claude Code and Vibe reliably read: neither
// surfaces the MCP server's `instructions` to its model, so a directive that
// lands only there never reaches them.
describe('the harness playbook file', () => {
	it('carries the language directive for a translated app', () => {
		const { playbook } = launchHarness('ru');

		expect(playbook).toBe(
			`${HARNESS_AWARENESS}\n\n${buildLanguageDirective('ru')}\n`,
		);
	});

	it('carries the playbook alone for an English app', () => {
		const { playbook } = launchHarness('en');

		expect(playbook).toBe(`${HARNESS_AWARENESS}\n`);
	});

	it('re-resolves the directive per launch, so a switched language lands', () => {
		expect(launchHarness('el').playbook).toContain(
			buildLanguageDirective('el') ?? '',
		);
		expect(launchHarness('en').playbook).not.toContain('LANGUAGE:');
	});

	it('points the launch command at the directory holding that file', () => {
		const { command } = launchHarness('ru');

		expect(command).toContain(
			`--append-system-prompt-file '${path.join(
				userDataDirectories.at(-1) ?? '',
				'harness-instructions',
				HARNESS_INSTRUCTIONS_FILENAME,
			)}'`,
		);
	});
});
