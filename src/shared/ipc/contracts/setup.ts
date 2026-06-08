export type SetupDiagnosticsStatus = 'blocked' | 'checking' | 'ready';
export type SetupCheckGroupId = 'core' | 'github' | 'linear' | 'pi' | 'storage';
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
export type SetupCheckStatus =
	| 'failure'
	| 'pending'
	| 'running'
	| 'success'
	| 'warning';
export type SetupRemediationActionKind =
	| 'open-external'
	| 'open-settings'
	| 'retry'
	| 'run-command'
	| 'select-path';

export interface SetupRemediationAction {
	command?: string;
	id: string;
	kind: SetupRemediationActionKind;
	label: string;
	target?: string;
}

export interface SetupCheckLogSnapshot {
	label: string;
	text: string;
	truncated?: boolean;
}

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
