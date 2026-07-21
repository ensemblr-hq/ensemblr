/**
 * Wires the agent-control layer into the Electron main process. Bundles the four
 * integration primitives main.ts injects into other services — the per-agent env
 * overlay, the harness-launch command augmenter, the native approval dialog, and
 * the resolved Pi control-extension path — behind one factory, so main.ts holds
 * only the composition and stays free of fs/path, dialog, and env-assembly detail.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';

import { type App, BrowserWindow, dialog } from 'electron';

import { roleForDepth } from '../../shared/agent-control.ts';
import { appendHarnessMcpConfig } from './harness-mcp-config.ts';
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
}

/** The main-process primitives the agent-control layer contributes. */
export interface AgentControlIntegration {
	resolveAgentControlEnv: AgentControlEnvResolver;
	augmentHarnessCommand: (
		command: string,
		harnessId: string,
		workspaceId: string,
	) => string;
	confirmAgentControlAction: (input: { summary: string }) => Promise<boolean>;
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
 * Surfaces a native confirmation dialog when an agent-control write needs user
 * approval (approval-required mode). Harnesses have no confirm channel, so the
 * app owns the prompt for every species.
 * @param input - The resolved caller summary to show.
 * @returns True when the user approves the action.
 */
async function confirmAgentControlAction({
	summary,
}: {
	summary: string;
}): Promise<boolean> {
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
	const { response } = parentWindow
		? await dialog.showMessageBox(parentWindow, options)
		: await dialog.showMessageBox(options);
	return response === 1;
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
		});
		return {
			ENSEMBLR_CONTROL_URL: serverUrl,
			ENSEMBLR_CONTROL_TOKEN: origin.token,
			ENSEMBLR_CONTROL_ROLE: roleForDepth(origin.depth),
		};
	};

	const augmentHarnessCommand = (
		command: string,
		harnessId: string,
		workspaceId: string,
	): string =>
		appendHarnessMcpConfig(
			command,
			harnessId,
			deps.getServerUrl(),
			resolveAgentControlEnv({
				workspaceId,
				sessionId: `ws:${workspaceId}`,
				species: 'harness',
			}).ENSEMBLR_CONTROL_TOKEN ?? null,
		);

	return {
		resolveAgentControlEnv,
		augmentHarnessCommand,
		confirmAgentControlAction,
		piControlExtensionPath: resolvePiControlExtensionPath(deps.app),
	};
}
