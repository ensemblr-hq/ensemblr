import { DEMO_RUN_SCRIPTS, DEMO_TERMINALS } from '../fixtures/dock.ts';
import {
	DEMO_CLOCK,
	DEMO_GIT_FILES,
	DEMO_REPOSITORIES,
} from '../fixtures/workspaces.ts';
import { type DemoChat, defineScenario } from '../scenario.ts';
import {
	assistantText,
	buildTranscript,
	reasoning,
	toolCall,
	toolResult,
	userPrompt,
} from '../transcript.ts';

const BRANCH_ID = 'demo-branch-afk';

/**
 * Builds a delegate an unattended orchestrator spawned. Every one carries
 * `afkMode`, because a conversation an AFK agent spawns inherits AFK — a strip
 * where only the parent were tinted would show a state the app never produces.
 * @param options - The delegate's identity and the conversation it had.
 * @returns The chat the tab strip, the session list, and the timeline all read.
 */
function delegate(options: {
	id: string;
	isStreaming?: boolean;
	steps: Parameters<typeof buildTranscript>[2];
	title: string;
}): DemoChat {
	return {
		afkMode: true,
		agentSessionId: `session-${options.id}`,
		branchId: `branch-${options.id}`,
		isStreaming: options.isStreaming ?? false,
		model: 'claude-sonnet-5',
		tabId: `tab-${options.id}`,
		title: options.title,
		transcript: buildTranscript(
			`branch-${options.id}`,
			DEMO_CLOCK,
			options.steps,
		),
	};
}

/** The approach the agent wrote down before its first edit, as step 1 asks. */
const APPROACH = `**Sizing this first.** Full loop, not the short path — this is the secret
boundary, and its failure mode is silent rather than visible in the diff.

**Approach.** Encrypt with Electron's \`safeStorage\` and keep the ciphertext in
SQLite, which binds to gnome-keyring or KWallet where one is running and stores
no plaintext either way.

**The alternative I rejected:** a \`libsecret\` binding. More direct, but it adds
a runtime dependency the app cannot guarantee — and SteamOS and Silverblue, the
machines most likely to run this, ship no daemon at all.

**The call I cannot put to you.** With no daemon, \`safeStorage\` obfuscates
rather than encrypts. I will take the degraded path and make it *say so* rather
than refuse to launch, and record it below for you to overrule.`;

/**
 * An unattended orchestrator part-way through the delivery loop, with its
 * delegates beside it.
 *
 * The subject is the composer's AFK chip and what it does to everything around
 * it: the dashed away-tinted composer border, and a tab strip where every chat
 * the run spawned carries the mode too. The strip's two states are both on
 * camera and neither is the chip's own glyph — `ChatSessionTabIcon` gives a
 * working chat its spinner in the mode's tint, and a settled delegate a bot in
 * the same tint, because status outranks mode and identity outranks both. The
 * keyboard-off glyph the chip uses reaches a tab only on a settled chat that is
 * nobody's delegate.
 *
 * Mid-turn on purpose: a finished turn folds its whole activity run into one
 * summary row, and the tool cards are what show the loop actually running.
 */
export default defineScenario({
	chat: {
		afkMode: true,
		agentSessionId: 'demo-session-afk',
		branchId: BRANCH_ID,
		isStreaming: true,
		model: 'claude-opus-5',
		title: 'Secret storage on Linux',
		transcript: buildTranscript(BRANCH_ID, DEMO_CLOCK, [
			userPrompt(
				'Secrets still go to the Keychain, so Linux has nowhere to put them. Make it work over there — I am heading out, so take it all the way.',
			),
			reasoning(
				'AFK is on. Nobody is going to answer a question and nobody will read the diff before it lands, which changes two things: I settle the open calls myself and record every one of them, and the change goes through the loop rather than straight to a commit.\n\nSizing it before I start. Two files is a small diff, but this is the secret boundary — the failure mode is silent and it is not visible in the diff — so the full loop rather than the short path.',
			),
			assistantText(APPROACH),
			toolCall('Task', 'call-survey', {
				description: 'Survey the secret call sites',
				prompt:
					'Report every call site that reads or writes a secret, with full paths, and say which of them assume a Keychain-shaped API.',
				subagent_type: 'general-purpose',
			}),
			toolResult(
				'call-survey',
				'Eleven call sites, all through src/main/secrets/. Two assume synchronous reads; the rest are already promise-shaped.',
			),
			toolCall('Edit', 'call-edit', {
				file_path: 'src/main/secrets/safe-storage.ts',
				new_string:
					'if (!safeStorage.isEncryptionAvailable()) {\n\treturn storeObfuscated(key, value);\n}\nreturn storeEncrypted(key, safeStorage.encryptString(value));',
				old_string: 'return keychain.setPassword(SERVICE, key, value);',
			}),
			toolResult(
				'call-edit',
				'Applied. 165 additions, 38 deletions in src/main/secrets/safe-storage.ts.',
			),
			toolCall('Bash', 'call-checks', {
				command: 'npm run check && npm run typecheck',
				description: 'Run the repository checks before opening the review',
			}),
			toolResult(
				'call-checks',
				'Checked 1284 files. No fixes applied.\n4 projects type-checked, 0 errors.',
			),
			assistantText(
				'Checks are green, so this is ready for a second reader rather than for a commit.\n\n**The call I flagged, now settled.** No daemon gets the degraded path rather than a refusal to launch — a user who cannot start the app cannot read the warning telling them why. `keyring-probe.ts` reports the session in the diagnostics rollup, so it is visible before a secret is entered rather than after.\n\nOpening the review now.',
			),
			toolCall('ensemblr_start_review', 'call-review', {
				title: 'Secret storage on Linux',
			}),
		]),
	},
	clock: DEMO_CLOCK,
	dockTab: 'run',
	gitFilesByPath: DEMO_GIT_FILES,
	id: 'afk-mode',
	label: 'Composer — AFK mode',
	repositories: DEMO_REPOSITORIES,
	route: '/projects/repo-ensemblr/workspaces/ws-secret-storage/chats/demo-chat',
	runScripts: DEMO_RUN_SCRIPTS,
	subAgents: [
		delegate({
			id: 'survey',
			steps: [
				userPrompt(
					'Report every call site that reads or writes a secret, with full paths, and say which of them assume a Keychain-shaped API.',
				),
				toolCall('Grep', 's-1', {
					pattern: 'setPassword|getPassword',
					path: 'src/main',
				}),
				toolResult(
					's-1',
					'src/main/secrets/safe-storage.ts:28\nsrc/main/secrets/safe-storage.ts:44\nsrc/main/linear/linear-tokens.ts:61',
				),
				assistantText(
					'**Eleven call sites, all funnelled through one module.**\n\nEvery read and write goes through `src/main/secrets/safe-storage.ts`, so the platform swap is contained to that file plus whatever it delegates to. Nothing outside `src/main/secrets/` names the Keychain directly.\n\n**Two assume a synchronous read**, which is the only shape problem:\n\n1. `src/main/linear/linear-tokens.ts:61` — reads inside a constructor.\n2. `src/main/config/config-resolution.ts:88` — reads while building the resolved config object.\n\nThe other nine already await. `safeStorage` is synchronous too, so neither actually breaks — but both would need moving if the store ever goes async, and neither has a test covering the missing-secret branch.',
				),
			],
			title: 'Survey the secret call sites',
		}),
		delegate({
			id: 'probe',
			isStreaming: true,
			steps: [
				userPrompt(
					'Determine what safeStorage.isEncryptionAvailable() returns on a session with no keyring daemon, and what the app can still tell the user in that state.',
				),
				toolCall('Bash', 'p-1', {
					command:
						'ELECTRON_RUN_AS_NODE=1 electron --test tests/main/secret-storage.test.ts',
					description: 'Exercise the probe against a daemonless session',
				}),
			],
			title: 'Probe keyring availability',
		}),
	],
	terminals: DEMO_TERMINALS,
	workspaceId: 'ws-secret-storage',
});
