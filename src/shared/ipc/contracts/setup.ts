/** Overall readiness of the setup diagnostics run. */
export type SetupDiagnosticsStatus = 'blocked' | 'checking' | 'ready';
/** Category a setup check belongs to. */
export type SetupCheckGroupId = 'core' | 'github' | 'linear' | 'pi' | 'storage';
/** Identifier for an individual setup diagnostic check. */
export type SetupCheckId =
	| 'config'
	| 'environment-variables'
	| 'gh-auth'
	| 'gh-cli'
	| 'git-executable'
	| 'linear-oauth'
	| 'managed-directories'
	| 'pi-agent-directory'
	| 'pi-executable'
	| 'pi-provider-model'
	| 'pi-rpc'
	| 'root-directory'
	| 'shell-process-launch'
	| 'sqlite-database';
/** Status of a single setup check. */
export type SetupCheckStatus =
	| 'failure'
	| 'pending'
	| 'running'
	| 'success'
	| 'warning';
/** Kind of remediation action offered for a failing setup check. */
export type SetupRemediationActionKind =
	| 'open-external'
	| 'open-settings'
	| 'retry'
	| 'run-command'
	| 'select-path';

/** A user-facing action that can fix a failing setup check. */
export interface SetupRemediationAction {
	command?: string;
	id: string;
	kind: SetupRemediationActionKind;
	label: string;
	target?: string;
}

/** Captured log output attached to a setup check. */
export interface SetupCheckLogSnapshot {
	label: string;
	text: string;
	truncated?: boolean;
}

/** IPC-safe snapshot of a single setup diagnostic check and its result. */
export interface SetupCheckSnapshot {
	blocking: boolean;
	description: string;
	detail: string;
	group: SetupCheckGroupId;
	id: SetupCheckId;
	logs: SetupCheckLogSnapshot[];
	remediationActions: SetupRemediationAction[];
	status: SetupCheckStatus;
	title: string;
	updatedAt: string;
}

/** Aggregate snapshot of all setup checks with rollup counts and overall status. */
export interface SetupDiagnosticsSnapshot {
	blockedCount: number;
	checks: SetupCheckSnapshot[];
	generatedAt: string;
	optionalCount: number;
	requiredCount: number;
	status: SetupDiagnosticsStatus;
	successCount: number;
	warningCount: number;
}

/** Setup-diagnostics IPC surface (first-run + recurring readiness checks). */
export interface SetupApi {
	setupDiagnostics: () => Promise<SetupDiagnosticsSnapshot>;
}
