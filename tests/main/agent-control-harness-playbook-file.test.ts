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
	buildCoAuthorDirective,
	buildLanguageDirective,
	buildLinkedIssueDirective,
	CO_AUTHOR_DIRECTIVE_HEADER,
	harnessAwareness,
	LINKED_ISSUE_DIRECTIVE_HEADER,
	type WorkspaceLinkedIssue,
} from '../../src/shared/agent-control.ts';
import type { AppLanguage } from '../../src/shared/i18n.ts';

/** The harness playbook with the architecture diagram on, as these tests wire it. */
const HARNESS_AWARENESS = harnessAwareness(true);

const WORKSPACE = 'ws-1';
const SERVER_URL = 'http://127.0.0.1:4321';
const INSTRUCTIONS = HARNESS_INSTRUCTIONS_FILENAME;

const LINKED_ISSUE: WorkspaceLinkedIssue = {
	accountId: 'acct-1',
	identifier: 'ENG-106',
	provider: 'linear',
	title: 'Expose Linear to agents',
	url: 'https://linear.app/the/issue/ENG-106',
};

const userDataDirectories: string[] = [];

/**
 * Wires the real integration against a throwaway `userData` directory and
 * returns the playbook file it writes, so the assertions read the bytes a
 * harness actually loads rather than the flag that points at them.
 *
 * Every optional collaborator is wired here rather than in {@link launchHarness}
 * so a test can leave one out and exercise the integration's own default, which
 * is the only way a default the app relies on is held to anything.
 * @param overrides - Dependencies to wire over the ones these tests share.
 * @returns The launch command's decoration and the playbook file's contents.
 */
const launchWith = (
	overrides: Partial<Parameters<typeof createAgentControlIntegration>[0]>,
) => {
	const userData = mkdtempSync(path.join(tmpdir(), 'ensemblr-harness-'));
	userDataDirectories.push(userData);
	const { augmentHarnessCommand } = createAgentControlIntegration({
		app: {
			isPackaged: false,
			getAppPath: () => process.cwd(),
			getPath: () => userData,
		} as never,
		getLanguage: () => 'en',
		readArchitectureDiagramEnabled: () => true,
		getServerUrl: () => SERVER_URL,
		originRegistry: createOriginRegistry({ generateToken: () => 'tok' }),
		readLinkedIssue: () => null,
		resolveWorkspaceCwd: () => '/tmp/ws-1',
		...overrides,
	});

	const command = augmentHarnessCommand('claude', 'claude', WORKSPACE);
	return {
		command,
		playbook: readFileSync(
			path.join(userData, 'harness-instructions', WORKSPACE, INSTRUCTIONS),
			'utf8',
		),
	};
};

/**
 * Launches a harness with every collaborator wired, for the assertions that care
 * about one directive and need the others held still.
 * @param language - The language the app reports while the harness launches.
 * @param linkedIssue - The ticket the workspace came from, if any.
 * @param coAuthor - Whether the commit credit is on.
 * @returns The launch command's decoration and the playbook file's contents.
 */
const launchHarness = (
	language: AppLanguage,
	linkedIssue: WorkspaceLinkedIssue | null = null,
	coAuthor = false,
) =>
	launchWith({
		getLanguage: () => language,
		readCoAuthorEnabled: () => coAuthor,
		readLinkedIssue: () => linkedIssue,
	});

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
				WORKSPACE,
				INSTRUCTIONS,
			)}'`,
		);
	});

	// The file is keyed by workspace precisely because of this block: one shared
	// file would hand every harness the ticket of whichever workspace launched
	// last, which is worse than naming no ticket at all.
	it('names the workspace linked issue so a harness moves it unprompted', () => {
		const { playbook } = launchHarness('en', LINKED_ISSUE);

		expect(playbook).toBe(
			`${HARNESS_AWARENESS}\n\n${buildLinkedIssueDirective(LINKED_ISSUE)}\n`,
		);
		expect(playbook).toContain('ENG-106');
	});

	it('leaves the issue block out for a workspace with no linked issue', () => {
		expect(launchHarness('en').playbook).not.toContain(
			LINKED_ISSUE_DIRECTIVE_HEADER,
		);
	});

	it('names the commit trailer while the credit is on', () => {
		const { playbook } = launchHarness('en', null, true);

		expect(playbook).toBe(
			`${HARNESS_AWARENESS}\n\n${buildCoAuthorDirective(true)}\n`,
		);
		expect(playbook).toContain('Co-authored-by: Ensemblr <howdy@ensemblr.dev>');
	});

	it('leaves the co-author block out while the credit is off', () => {
		expect(launchHarness('en').playbook).not.toContain(
			CO_AUTHOR_DIRECTIVE_HEADER,
		);
	});

	// The credit ships on, so the reader's own default is what a caller that never
	// wires one falls back to. Asserted here because the app reads the setting
	// through this integration and nothing else would catch the default flipping.
	it('names the commit trailer when no reader is wired', () => {
		const { playbook } = launchWith({});

		expect(playbook).toBe(
			`${HARNESS_AWARENESS}\n\n${buildCoAuthorDirective(true)}\n`,
		);
	});

	// A GitHub-linked workspace has no control op that could move its issue, so a
	// block telling the harness to keep it current would name no tool at all.
	it('leaves the issue block out for a GitHub-linked workspace', () => {
		expect(
			launchHarness('en', { ...LINKED_ISSUE, provider: 'github' }).playbook,
		).not.toContain(LINKED_ISSUE_DIRECTIVE_HEADER);
	});
});
