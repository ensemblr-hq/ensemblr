import type { DatabaseSync } from 'node:sqlite';
import { ipcMain } from 'electron';
import { findHarnessDefinition } from '../../../shared/agents.ts';
import { IPC_CHANNELS } from '../../../shared/ipc/channels';
import type {
	LaunchAgentHarnessResult,
	ListAgentHarnessesResult,
} from '../../../shared/ipc/contracts/agents';
import type { HarnessDetectionService } from '../../agents/index.ts';
import type { EnsemblrDatabaseService } from '../../storage';
import {
	getChatTabById,
	setChatTabMetadata,
} from '../../storage/repositories/chat-tab-repository.ts';
import type { TerminalService } from '../../terminal';
import {
	launchAgentHarnessRequestSchema,
	resumeAgentHarnessRequestSchema,
} from '../request-schemas.ts';

/** Feature-off diagnostic result, refused before any PATH lookup happens. */
function harnessesDisabledResult(): LaunchAgentHarnessResult {
	return {
		diagnostics: [
			{
				code: 'harness-unavailable',
				message:
					'Third-party CLI harnesses are switched off in Settings → Experimental.',
				severity: 'error',
			},
		],
		session: null,
	};
}

/** Harness-unavailable diagnostic result reused by launch and resume. */
function harnessUnavailableResult(harnessId: string): LaunchAgentHarnessResult {
	return {
		diagnostics: [
			{
				code: 'harness-unavailable',
				message: `The agent harness "${harnessId}" is not installed or is unknown.`,
				severity: 'error',
			},
		],
		session: null,
	};
}

/**
 * Rewrites a terminal tab's stored `terminalId` metadata to a freshly spawned
 * session, preserving the other harness metadata fields. No-op when the tab or
 * database is missing, so a failed writeback never blocks the running PTY.
 * @param database - Open SQLite connection, or null when unavailable.
 * @param chatTabId - Id of the terminal tab to repoint.
 * @param terminalId - Id of the newly spawned terminal session.
 */
function repointTerminalTab(
	database: DatabaseSync | null,
	chatTabId: string,
	terminalId: string,
): void {
	if (!database) {
		return;
	}
	const tab = getChatTabById({ database, id: chatTabId });
	if (!tab) {
		return;
	}
	setChatTabMetadata({
		database,
		id: chatTabId,
		metadata: { ...tab.metadata, terminalId },
	});
}

/**
 * Registers the agent-harness IPC handlers: detecting installed coding-agent
 * CLIs, launching one inside a workspace terminal session, and resuming one
 * into an existing tab after an app restart. Launch and resume commands are
 * rebuilt from the trusted registry via the detection service, so the renderer
 * only ever supplies a harness id — never shell text.
 *
 * Launch and resume both refuse while the Experimental switch is off, which is
 * the backstop under the unmounted launcher: a terminal tab restored from a
 * previous session would otherwise respawn a harness the user has since turned
 * off, and the renderer archives that tab instead once this refuses it.
 * @param options - Required services.
 */
export function registerAgentHandlers({
	augmentHarnessCommand = (command) => command,
	databaseService,
	harnessDetectionService,
	readTuiHarnessesEnabled = () => false,
	terminalService,
}: {
	/**
	 * Adds the agent-control MCP config and the harness playbook to a launch
	 * command so the harness can reach the app and knows what for. Defaults to
	 * identity when the control layer is disabled.
	 */
	augmentHarnessCommand?: (
		command: string,
		harnessId: string,
		workspaceId: string,
	) => string;
	databaseService: EnsemblrDatabaseService;
	harnessDetectionService: HarnessDetectionService;
	/**
	 * Whether third-party CLI harnesses are on, read live off the watched settings
	 * file. Defaults to off, so a build that never wires it launches none.
	 */
	readTuiHarnessesEnabled?: () => boolean;
	terminalService: TerminalService;
}): void {
	ipcMain.handle(
		IPC_CHANNELS.listAgentHarnesses,
		(): Promise<ListAgentHarnessesResult> =>
			readTuiHarnessesEnabled()
				? harnessDetectionService.listHarnesses()
				: Promise.resolve({ harnesses: [] }),
	);

	ipcMain.handle(
		IPC_CHANNELS.launchAgentHarness,
		async (_event, raw: unknown): Promise<LaunchAgentHarnessResult> => {
			if (!readTuiHarnessesEnabled()) {
				return harnessesDisabledResult();
			}
			const { harnessId, workspaceId } =
				launchAgentHarnessRequestSchema.parse(raw);
			const command =
				await harnessDetectionService.resolveLaunchCommand(harnessId);

			if (!command) {
				return harnessUnavailableResult(harnessId);
			}

			const result = await terminalService.create({
				command: augmentHarnessCommand(command, harnessId, workspaceId),
				harnessId,
				kind: 'agent',
				title: findHarnessDefinition(harnessId)?.label ?? harnessId,
				workspaceId,
			});

			return { diagnostics: result.diagnostics, session: result.session };
		},
	);

	ipcMain.handle(
		IPC_CHANNELS.resumeAgentHarness,
		async (_event, raw: unknown): Promise<LaunchAgentHarnessResult> => {
			if (!readTuiHarnessesEnabled()) {
				return harnessesDisabledResult();
			}
			const { chatTabId, fresh, harnessId, sessionId, workspaceId } =
				resumeAgentHarnessRequestSchema.parse(raw);
			const command = fresh
				? await harnessDetectionService.resolveLaunchCommand(harnessId)
				: await harnessDetectionService.resolveResumeCommand(
						harnessId,
						sessionId,
					);

			if (!command) {
				return harnessUnavailableResult(harnessId);
			}

			const result = await terminalService.create({
				command: augmentHarnessCommand(command, harnessId, workspaceId),
				harnessId,
				kind: 'agent',
				resumed: !fresh,
				title: findHarnessDefinition(harnessId)?.label ?? harnessId,
				workspaceId,
			});

			if (result.session) {
				repointTerminalTab(
					databaseService.getConnection()?.database ?? null,
					chatTabId,
					result.session.id,
				);
			}

			return { diagnostics: result.diagnostics, session: result.session };
		},
	);
}
