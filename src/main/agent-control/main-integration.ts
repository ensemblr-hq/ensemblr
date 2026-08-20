/**
 * Wires the agent-control layer into the Electron main process. Bundles the four
 * integration primitives main.ts injects into other services — the per-agent env
 * overlay, the harness-launch command augmenter, the native approval dialog, and
 * the resolved Pi control-extension path — behind one factory, so main.ts holds
 * only the composition and stays free of fs/path, dialog, and env-assembly detail.
 */
import { existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { type App, BrowserWindow, dialog } from 'electron';

import {
	buildLanguageDirective,
	buildLinkedIssueDirective,
	HARNESS_AWARENESS,
	resolveAgentRole,
	type WorkspaceLinkedIssue,
} from '../../shared/agent-control.ts';
import type { AppLanguage } from '../../shared/i18n.ts';
import {
	CONTROL_ROLE_ENV_KEY,
	CONTROL_TOKEN_ENV_KEY,
	CONTROL_URL_ENV_KEY,
} from './control-env-keys.ts';
import {
	decorateHarnessCommand,
	HARNESS_INSTRUCTIONS_FILENAME,
} from './harness-launch-config.ts';
import type { OriginRegistry } from './origin-registry.ts';
import type { AgentControlEnvResolver } from './ports.ts';

/** Collaborators for {@link createAgentControlIntegration}. */
interface AgentControlIntegrationDeps {
	app: App;
	originRegistry: OriginRegistry;
	/** Absolute cwd of a workspace, or null when it has no resolvable path. */
	resolveWorkspaceCwd: (workspaceId: string) => string | null;
	/** Current control-server base URL, or null before the server is up. */
	getServerUrl: () => string | null;
	/** The language the app renders in, for the harness playbook's directive. */
	getLanguage: () => AppLanguage;
	/**
	 * Reads the issue a workspace was created from, for the linked-issue block in
	 * the harness playbook. Omitted, a harness launches with no prose about the
	 * ticket and moves it only when asked.
	 */
	readLinkedIssue?: (workspaceId: string) => WorkspaceLinkedIssue | null;
	/**
	 * Whether a session was spawned as somebody's sub-agent, read from the durable
	 * tab marker rather than lineage. Omitted, the role falls back to spawn depth,
	 * which reads a resumed sub-agent as a root orchestrator.
	 */
	isSpawnedSubAgent?: (agentSessionId: string) => boolean;
	/**
	 * Root of the shipped Agent Skill plugin, which the Claude harness loads with
	 * `--plugin-dir`. Omitted, a harness launches with the playbook but without
	 * the deeper reference behind it.
	 */
	skillPluginDirectory?: string | null;
}

/** The main-process primitives the agent-control layer contributes. */
export interface AgentControlIntegration {
	resolveAgentControlEnv: AgentControlEnvResolver;
	augmentHarnessCommand: (
		command: string,
		harnessId: string,
		workspaceId: string,
	) => string;
	confirmAgentControlAction: (input: {
		signal?: AbortSignal;
		summary: string;
	}) => Promise<boolean>;
	/** Path to the shipped Pi control extension, or null to skip loading it. */
	piControlExtensionPath: string | null;
}

/**
 * Resolves the shipped Pi control extension path, or null when the file is
 * absent — in which case Pi launches with no control tools. Pi's extension
 * loader bundles `typebox` and `@earendil-works/pi-coding-agent` (jiti alias /
 * virtualModules), so the extension needs no colocated `node_modules`.
 * @param app - The Electron app, for packaged vs. dev path resolution.
 * @returns Absolute path to the extension file, or null to skip loading it.
 */
function resolvePiControlExtensionPath(app: App): string | null {
	const candidates = app.isPackaged
		? [path.join(process.resourcesPath, 'pi-extensions')]
		: [
				path.join(app.getAppPath(), 'resources', 'pi-extensions'),
				path.join(process.cwd(), 'resources', 'pi-extensions'),
			];
	for (const base of candidates) {
		const extension = path.join(base, 'ensemblr-control.mts');
		if (existsSync(extension)) {
			return extension;
		}
	}
	return null;
}

/**
 * Writes the harness playbook into a per-workspace directory under `userData`
 * and returns that directory, or null when the write fails — a harness then
 * launches with MCP tools but no prose about them, which beats not launching.
 *
 * Called per launch rather than once at construction: `main.ts` requires the
 * module-scope service graph to stay construction-only so a process that loses
 * the single-instance lock never touches shared userData before exiting. Doing
 * it per launch also keeps the file tracking the shipped playbook and restores
 * it if anything removed it. It lives alone in its directory because Vibe
 * trusts the whole directory it is pointed at.
 *
 * The directory is keyed by workspace because the file is no longer the same for
 * every one: it carries the linked-issue directive, which names the ticket *this*
 * workspace was created from. One shared file would hand every harness whichever
 * workspace launched last. Two launches in the same workspace still race, so the
 * write goes through a staging file and a rename: a concurrent reader sees the
 * previous playbook or the new one and never a half-truncated prompt. A staging
 * file left behind by a failed write is inert — a harness reads only `AGENTS.md`
 * — and the next write reuses and consumes it.
 *
 * Writing per launch also re-resolves both directives per launch, which is the
 * only reliable channel a harness has for them: it reads this file once at
 * startup and the app never prompts it again.
 * @param app - The Electron app, for the `userData` path.
 * @param language - The language the app is rendering in.
 * @param workspaceId - Workspace the harness is launching into, keying its directory.
 * @param issueDirective - The workspace's linked-issue block, or null when it has none.
 * @returns Absolute path to the directory holding the playbook, or null.
 */
function writeHarnessInstructions(
	app: App,
	language: AppLanguage,
	workspaceId: string,
	issueDirective: string | null,
): string | null {
	const directory = path.join(
		app.getPath('userData'),
		'harness-instructions',
		workspaceId,
	);
	const playbook = path.join(directory, HARNESS_INSTRUCTIONS_FILENAME);
	const staging = `${playbook}.tmp`;
	const blocks = [
		HARNESS_AWARENESS,
		buildLanguageDirective(language),
		issueDirective,
	].filter((block) => block !== null);
	try {
		mkdirSync(directory, { recursive: true });
		writeFileSync(staging, `${blocks.join('\n\n')}\n`, 'utf8');
		renameSync(staging, playbook);
		return directory;
	} catch {
		return null;
	}
}

/**
 * Surfaces a native confirmation dialog when an agent-control write needs user
 * approval (approval-required mode). Harnesses have no confirm channel, so the
 * app owns the prompt for every species.
 *
 * Electron offers no way to dismiss a message box the app itself opened, so a
 * caller that goes away mid-prompt is answered by giving up on the dialog rather
 * than by closing it: the box stays on screen until the user clicks, and their
 * click is inert. That is the half that matters — the op never runs for a caller
 * that stopped listening, which is what would otherwise start a terminal or
 * launch a harness for nobody an hour after the fact.
 * @param input - The caller summary to show, and the signal that abandons it.
 * @returns True when the user approves the action, false when they decline or
 *   the caller goes away first.
 */
async function confirmAgentControlAction({
	signal,
	summary,
}: {
	signal?: AbortSignal;
	summary: string;
}): Promise<boolean> {
	if (signal?.aborted) {
		return false;
	}
	const parentWindow = BrowserWindow.getFocusedWindow();
	const options = {
		type: 'question' as const,
		buttons: ['Deny', 'Allow'],
		defaultId: 0,
		cancelId: 0,
		title: 'Agent control request',
		message: 'An agent requested to control Ensemblr.',
		detail: summary,
	};
	const answered = parentWindow
		? dialog.showMessageBox(parentWindow, options)
		: dialog.showMessageBox(options);
	const abandoned = new Promise<null>((resolve) => {
		signal?.addEventListener('abort', () => resolve(null), { once: true });
	});
	const outcome = await Promise.race([answered, abandoned]);
	return outcome?.response === 1;
}

/**
 * Builds the agent-control main-process integration primitives.
 * @param deps - The Electron app, origin registry, workspace-cwd lookup, and
 *   a live control-server URL getter.
 * @returns The env resolver, harness-command augmenter, confirm dialog, and
 *   resolved extension path.
 */
export function createAgentControlIntegration(
	deps: AgentControlIntegrationDeps,
): AgentControlIntegration {
	const resolveAgentControlEnv: AgentControlEnvResolver = (
		identity,
	): Record<string, string> => {
		const serverUrl = deps.getServerUrl();
		if (!serverUrl) {
			return {};
		}
		const cwd = deps.resolveWorkspaceCwd(identity.workspaceId);
		if (!cwd) {
			return {};
		}
		const origin = deps.originRegistry.register({
			sessionId: identity.sessionId,
			workspaceId: identity.workspaceId,
			workspaceCwd: cwd,
			species: identity.species ?? 'pi',
			parentSessionId: identity.parentSessionId ?? null,
			delegation: identity.delegation,
		});
		const marked = deps.isSpawnedSubAgent?.(identity.sessionId) === true;
		return {
			[CONTROL_URL_ENV_KEY]: serverUrl,
			[CONTROL_TOKEN_ENV_KEY]: origin.token,
			[CONTROL_ROLE_ENV_KEY]: resolveAgentRole(marked, origin.depth),
		};
	};

	const augmentHarnessCommand = (
		command: string,
		harnessId: string,
		workspaceId: string,
	): string =>
		decorateHarnessCommand(command, {
			baseUrl: deps.getServerUrl(),
			harnessId,
			instructionsDirectory: writeHarnessInstructions(
				deps.app,
				deps.getLanguage(),
				workspaceId,
				buildLinkedIssueDirective(deps.readLinkedIssue?.(workspaceId) ?? null),
			),
			skillPluginDirectory: deps.skillPluginDirectory ?? null,
			token:
				resolveAgentControlEnv({
					workspaceId,
					sessionId: `ws:${workspaceId}`,
					species: 'harness',
				})[CONTROL_TOKEN_ENV_KEY] ?? null,
		});

	return {
		resolveAgentControlEnv,
		augmentHarnessCommand,
		confirmAgentControlAction,
		piControlExtensionPath: resolvePiControlExtensionPath(deps.app),
	};
}
