/**
 * Wires the agent-control layer into the Electron main process. Bundles the four
 * integration primitives main.ts injects into other services — the per-agent env
 * overlay, the harness-launch command augmenter, the native approval dialog, and
 * the resolved Pi control-extension path — behind one factory, so main.ts holds
 * only the composition and stays free of fs/path, dialog, and env-assembly detail.
 */
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { type App, BrowserWindow, dialog } from 'electron';

import {
	type AgentSessionLineage,
	type AwarenessFeatures,
	buildCoAuthorDirective,
	buildDelegationInitiativeDirective,
	buildLanguageDirective,
	buildLinkedIssueDirective,
	type DelegationInitiative,
	harnessAwareness,
	resolveAgentRole,
	type WorkspaceLinkedIssue,
} from '../../shared/agent-control.ts';
import type { AppLanguage } from '../../shared/i18n.ts';
import {
	CONTROL_ARCHITECTURE_ENABLED,
	CONTROL_ARCHITECTURE_ENV_KEY,
	CONTROL_DEPTH_ENV_KEY,
	CONTROL_ROLE_ENV_KEY,
	CONTROL_TOKEN_ENV_KEY,
	CONTROL_TUI_HARNESSES_ENABLED,
	CONTROL_TUI_HARNESSES_ENV_KEY,
	CONTROL_URL_ENV_KEY,
} from './control-env-keys.ts';
import {
	decorateHarnessCommand,
	HARNESS_INSTRUCTIONS_FILENAME,
} from './harness-launch-config.ts';
import type { OriginRegistry } from './origin-registry.ts';
import type { AgentControlEnvResolver, AgentSpecies } from './ports.ts';

/** Collaborators for {@link createAgentControlIntegration}. */
interface AgentControlIntegrationDeps {
	app: App;
	originRegistry: OriginRegistry;
	/** Absolute cwd of a workspace, or null when it has no resolvable path. */
	resolveWorkspaceCwd: (workspaceId: string) => string | null;
	/** Resolves validated persisted lineage for a native conversation session. */
	resolveSessionLineage?: (sessionId: string) => AgentSessionLineage;
	/**
	 * Absolute path of the Concierge's home, which is its cwd and the only tree
	 * it may write to. Omitted, a Concierge registers no origin and opens without
	 * control tools, exactly as a workspace agent does before the root is known.
	 */
	resolveConciergeCwd?: () => string | null;
	/** Current control-server base URL, or null before the server is up. */
	getServerUrl: () => string | null;
	/** The language the app renders in, for the harness playbook's directive. */
	getLanguage: () => AppLanguage;
	/**
	 * Whether the architecture diagram feature is on. Off, the harness playbook
	 * never mentions the diagram, matching the tool list the MCP endpoint serves
	 * it. Omitted, the feature reads as off.
	 */
	readArchitectureDiagramEnabled?: () => boolean;
	/**
	 * Whether third-party CLI harnesses are on. Off, the harness playbook never
	 * mentions launching another one, matching the tool list the MCP endpoint
	 * serves it. Omitted, the feature reads as off.
	 */
	readTuiHarnessesEnabled?: () => boolean;
	/**
	 * Whether Ensemblr is credited as a commit co-author, which it is until the
	 * user turns it off. Off, the harness playbook never mentions the trailer.
	 * Omitted, the credit reads as on, which is also its shipped default.
	 */
	readCoAuthorEnabled?: () => boolean;
	/**
	 * Whether an orchestrator may decide to delegate on its own. `on-request`
	 * puts the delegate-when-asked block into the harness playbook; a harness is
	 * a delegating root, so the setting has to reach it or it silently applies to
	 * chat tabs alone. Omitted, the judgement reads as the agent's, which is the
	 * shipped default.
	 */
	readDelegationInitiative?: () => DelegationInitiative;
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
	 * Roots of the shipped Agent Skill plugins, which the Claude harness loads
	 * with one `--plugin-dir` each. Read per launch, because the architecture
	 * bundle follows a setting the user can flip. Omitted, a harness launches with
	 * the playbook but without the deeper reference behind it.
	 */
	readSkillPluginDirectories?: () => readonly string[];
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
	/**
	 * Invalidates the token behind a workspace's shared harness origin. Called
	 * when the workspace has no live terminal left, because that origin has no
	 * session of its own for `releaseSession` to reach.
	 */
	releaseWorkspaceHarnessOrigins: (workspaceId: string) => void;
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
 * Writing per launch also re-resolves every directive per launch, which is the
 * only reliable channel a harness has for them: it reads this file once at
 * startup and the app never prompts it again.
 * @param input - The app and workspace the playbook is written for, plus the
 *   directive blocks to append after the awareness and language ones. Named
 *   rather than positional because the blocks are interchangeable `string | null`
 *   values that a positional list would let a caller silently transpose.
 * @returns Absolute path to the directory holding the playbook, or null.
 */
function writeHarnessInstructions(input: {
	app: App;
	directives: readonly (string | null)[];
	features: AwarenessFeatures;
	language: AppLanguage;
	workspaceId: string;
}): string | null {
	const directory = path.join(
		input.app.getPath('userData'),
		'harness-instructions',
		input.workspaceId,
	);
	const playbook = path.join(directory, HARNESS_INSTRUCTIONS_FILENAME);
	const staging = `${playbook}.tmp`;
	const blocks = [
		harnessAwareness(input.features),
		buildLanguageDirective(input.language),
		...input.directives,
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
 * @param deps - The Electron app, origin registry, workspace-cwd lookup, and a
 *   live control-server URL getter. Every optional collaborator takes its
 *   documented default here rather than at each read, so the primitives below
 *   call a plain function and a new one cannot be read with the wrong fallback.
 * @returns The env resolver, harness-command augmenter, confirm dialog, and
 *   resolved extension path.
 */
export function createAgentControlIntegration({
	app,
	getLanguage,
	getServerUrl,
	isSpawnedSubAgent = () => false,
	originRegistry,
	readArchitectureDiagramEnabled = () => false,
	readCoAuthorEnabled = () => true,
	readDelegationInitiative = () => 'automatic',
	readLinkedIssue = () => null,
	readSkillPluginDirectories = () => [],
	readTuiHarnessesEnabled = () => false,
	resolveConciergeCwd = () => null,
	resolveSessionLineage,
	resolveWorkspaceCwd,
}: AgentControlIntegrationDeps): AgentControlIntegration {
	const appRunId = randomUUID();

	/**
	 * Scopes a harness identity to this run of the app.
	 *
	 * Every terminal in a workspace shares one origin under the synthetic session
	 * id `ws:<workspaceId>`, because a PTY has no session the app mints a token
	 * for. That id is also the root of its own lineage, so it is what the durable
	 * spawn ledger counts against — and a workspace id never changes, which
	 * turned a 20-spawn budget "per root tree" into a permanent cap on the whole
	 * history of a workspace's terminals: twenty file tabs over as many weeks and
	 * every later spawn is refused with a fork-bomb message, across restarts.
	 * Appending the run id gives the budget something that actually ends. The
	 * workspace id stays in the key because the identity and scope checks read it
	 * from the origin, and both call sites reach the origin through here.
	 * @param identity - The identity a caller asked for an overlay for.
	 * @returns The session id to register, run-scoped for a harness.
	 */
	const originSessionId = (identity: {
		sessionId: string;
		species?: AgentSpecies;
	}): string =>
		identity.species === 'harness'
			? `${identity.sessionId}:${appRunId}`
			: identity.sessionId;

	const resolveAgentControlEnv: AgentControlEnvResolver = (
		identity,
	): Record<string, string> => {
		const serverUrl = getServerUrl();
		if (!serverUrl) {
			return {};
		}
		const concierge = identity.concierge === true;
		const cwd = concierge
			? resolveConciergeCwd()
			: resolveWorkspaceCwd(identity.workspaceId);
		if (!cwd) {
			return {};
		}
		const species = identity.species ?? 'pi';
		const lineage =
			identity.lineage ??
			(!concierge && species !== 'harness'
				? resolveSessionLineage?.(identity.sessionId)
				: undefined);
		const origin = originRegistry.register({
			sessionId: originSessionId({ sessionId: identity.sessionId, species }),
			workspaceId: identity.workspaceId,
			concierge,
			workspaceCwd: cwd,
			species,
			parentSessionId: identity.parentSessionId ?? null,
			lineage,
			delegation: identity.delegation,
		});
		// A Concierge can never carry the sub-agent marker, and reading it would
		// query the database for a chat tab that does not exist.
		const marked = !concierge && isSpawnedSubAgent(identity.sessionId);
		return {
			[CONTROL_URL_ENV_KEY]: serverUrl,
			[CONTROL_TOKEN_ENV_KEY]: origin.token,
			[CONTROL_DEPTH_ENV_KEY]: String(origin.depth),
			[CONTROL_ROLE_ENV_KEY]: resolveAgentRole(
				marked,
				origin.depth,
				origin.concierge,
			),
			...(readArchitectureDiagramEnabled()
				? { [CONTROL_ARCHITECTURE_ENV_KEY]: CONTROL_ARCHITECTURE_ENABLED }
				: {}),
			...(readTuiHarnessesEnabled()
				? { [CONTROL_TUI_HARNESSES_ENV_KEY]: CONTROL_TUI_HARNESSES_ENABLED }
				: {}),
		};
	};

	const augmentHarnessCommand = (
		command: string,
		harnessId: string,
		workspaceId: string,
	): string =>
		decorateHarnessCommand(command, {
			baseUrl: getServerUrl(),
			harnessId,
			instructionsDirectory: writeHarnessInstructions({
				app,
				features: {
					architectureDiagram: readArchitectureDiagramEnabled(),
					tuiHarnesses: readTuiHarnessesEnabled(),
				},
				directives: [
					buildLinkedIssueDirective(readLinkedIssue(workspaceId)),
					buildDelegationInitiativeDirective({
						delegation: 'ensemblr',
						initiative: readDelegationInitiative(),
						role: 'orchestrator',
						unattended: false,
					}),
					buildCoAuthorDirective(readCoAuthorEnabled()),
				],
				language: getLanguage(),
				workspaceId,
			}),
			skillPluginDirectories: readSkillPluginDirectories(),
			token:
				resolveAgentControlEnv({
					workspaceId,
					sessionId: `ws:${workspaceId}`,
					species: 'harness',
				})[CONTROL_TOKEN_ENV_KEY] ?? null,
		});

	/**
	 * Releases every harness origin registered against a workspace, invalidating
	 * the token each one minted.
	 *
	 * Only the harness species: an agent conversation in the same workspace owns
	 * its origin for as long as its session lives and is released with it.
	 * @param workspaceId - Workspace whose harness origins to invalidate
	 */
	const releaseWorkspaceHarnessOrigins = (workspaceId: string): void => {
		for (const origin of originRegistry.originsInWorkspace(workspaceId)) {
			if (origin.species === 'harness') {
				originRegistry.release(origin.sessionId);
			}
		}
	};

	return {
		resolveAgentControlEnv,
		augmentHarnessCommand,
		confirmAgentControlAction,
		releaseWorkspaceHarnessOrigins,
		piControlExtensionPath: resolvePiControlExtensionPath(app),
	};
}
