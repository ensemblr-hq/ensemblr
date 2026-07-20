/**
 * Wire types for the AI coding-agent harness surface: detecting which harness
 * CLIs are installed and launching one inside a workspace terminal tab.
 */

import type { TerminalDiagnostic, TerminalSessionSnapshot } from './terminal';

/** IPC-safe summary of one known harness and whether it is installed. */
export interface AgentHarnessSummary {
	/** Stable registry id used to launch the harness. */
	id: string;
	/** Human-readable name shown in the robot menu. */
	label: string;
	/** True when the harness binary was found on the machine. */
	available: boolean;
}

/** The known harnesses with their detected availability. */
export interface ListAgentHarnessesResult {
	harnesses: AgentHarnessSummary[];
}

/** Request to launch a harness in a workspace terminal. */
export interface LaunchAgentHarnessRequest {
	harnessId: string;
	workspaceId: string;
}

/** Result of launching a harness: the created terminal session, or diagnostics. */
export interface LaunchAgentHarnessResult {
	diagnostics: TerminalDiagnostic[];
	session: TerminalSessionSnapshot | null;
}

/**
 * Request to resume a harness in the terminal tab that owns it, respawning its
 * conversation after an app restart. `chatTabId` identifies the tab whose stored
 * `terminalId` metadata is rewritten to the freshly spawned session. When
 * `fresh` is true the tab respawns with the harness's launch command (a new
 * conversation) instead of its cwd-scoped resume command; used for the extra
 * tabs of a harness so two instances never resume into one shared session log.
 */
export interface ResumeAgentHarnessRequest {
	chatTabId: string;
	harnessId: string;
	workspaceId: string;
	fresh?: boolean;
}

/** Agent-harness slice of the `window.ensemblr` API. */
export interface AgentsApi {
	listAgentHarnesses: () => Promise<ListAgentHarnessesResult>;
	launchAgentHarness: (
		request: LaunchAgentHarnessRequest,
	) => Promise<LaunchAgentHarnessResult>;
	resumeAgentHarness: (
		request: ResumeAgentHarnessRequest,
	) => Promise<LaunchAgentHarnessResult>;
}
