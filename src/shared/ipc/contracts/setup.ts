/** Overall readiness of the setup diagnostics run. */
export type SetupDiagnosticsStatus = 'blocked' | 'checking' | 'ready';
/** Category a setup check belongs to. */
export type SetupCheckGroupId =
	| 'claude'
	| 'core'
	| 'github'
	| 'linear'
	| 'pi'
	| 'storage';
/** Identifier for an individual setup diagnostic check. */
export type SetupCheckId =
	| 'claude-executable'
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
	| 'secret-storage'
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

/**
 * Codes for every detail line the setup layer authors itself, so the renderer
 * can render it in the app language. A check whose detail is passthrough — a
 * `Error.message`, an upstream service diagnostic, or tool stderr — carries no
 * code and surfaces verbatim.
 */
export type SetupDetailCode =
	| 'claude-executable-not-found'
	| 'claude-executable-on-path'
	| 'claude-executable-override'
	| 'claude-executable-override-broken'
	| 'claude-unknown-error'
	| 'config-loaded'
	| 'config-missing'
	| 'database-open-failed'
	| 'database-ready'
	| 'environment-cataloged'
	| 'environment-missing-required'
	| 'environment-unknown-error'
	| 'gh-auth-cli-not-found'
	| 'gh-auth-output-truncated'
	| 'gh-auth-ready'
	| 'gh-auth-required'
	| 'gh-auth-timeout'
	| 'gh-auth-unknown-error'
	| 'gh-cli-available'
	| 'gh-cli-available-unknown-version'
	| 'gh-cli-failed'
	| 'gh-cli-failed-unknown'
	| 'gh-cli-not-found'
	| 'gh-cli-output-truncated'
	| 'gh-cli-timeout'
	| 'gh-cli-unknown-error'
	| 'git-available'
	| 'git-available-unknown-version'
	| 'git-failed'
	| 'git-failed-unknown'
	| 'git-not-found'
	| 'git-output-truncated'
	| 'git-timeout'
	| 'git-unknown-error'
	| 'linear-connected'
	| 'linear-connected-accounts'
	| 'linear-connected-as'
	| 'linear-connected-with-organization'
	| 'linear-not-configured'
	| 'linear-not-connected'
	| 'linear-reconnect-required'
	| 'linear-unknown-error'
	| 'managed-directories-attention'
	| 'managed-directories-ready'
	| 'pi-agent-directory-ready'
	| 'pi-agent-directory-unknown-error'
	| 'pi-agent-directory-unverified'
	| 'pi-executable-not-found'
	| 'pi-executable-probe-warning'
	| 'pi-executable-ready-no-probe'
	| 'pi-executable-ready-with-probe'
	| 'pi-executable-unknown-error'
	| 'pi-models-none'
	| 'pi-models-ready'
	| 'pi-models-unknown-error'
	| 'pi-models-unverified'
	| 'pi-rpc-invalid'
	| 'pi-rpc-ready'
	| 'pi-rpc-unknown-error'
	| 'root-directory-ready'
	| 'secret-storage-encrypted'
	| 'secret-storage-plaintext'
	| 'secret-storage-unavailable'
	| 'secret-storage-unknown-error'
	| 'shell-fallback-environment'
	| 'shell-ready'
	| 'shell-smoke-failed'
	| 'shell-unknown-error'
	| 'unknown-check-error';

/**
 * Codes for the log labels the setup layer authors. Stream names (`stdout`,
 * `stderr`, `cwd`) and upstream diagnostic codes stay verbatim and carry none.
 */
export type SetupLogLabelCode =
	| 'agent-directory-path'
	| 'catalog-entries'
	| 'command'
	| 'config-diagnostic'
	| 'configured-variables'
	| 'database-error'
	| 'database-path'
	| 'executable-path'
	| 'first-jsonl-frame'
	| 'keyring-backend'
	| 'masked-secrets'
	| 'model-count'
	| 'pi-probe'
	| 'provider-count'
	| 'reserved-runtime-variables'
	| 'root-path'
	| 'source';

/**
 * Values interpolated into a localized setup string. Kept to primitives so the
 * payload survives the structured clone the IPC bridge performs.
 */
export type SetupMessageParams = Record<string, number | string>;

/** A detail line the renderer localizes: a catalogue code plus its values. */
export interface SetupDetailMessage {
	code: SetupDetailCode;
	params?: SetupMessageParams;
}

/** A log label the renderer localizes: a catalogue code plus its values. */
export interface SetupLogLabelMessage {
	code: SetupLogLabelCode;
	params?: SetupMessageParams;
}

/**
 * A user-facing action that can fix a failing setup check. `label` is the
 * English source the support bundle records; surfaces render the translation
 * keyed by `id`.
 */
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
	labelMessage?: SetupLogLabelMessage;
	text: string;
	truncated?: boolean;
}

/**
 * IPC-safe snapshot of a single setup diagnostic check and its result.
 *
 * `title`, `description`, and `detail` are the English source the support
 * bundle records. Surfaces render the app language instead: `title` translated
 * from `id`, and `detail` from `detailMessage` when the setup layer authored
 * the line rather than passing an upstream message through.
 */
export interface SetupCheckSnapshot {
	blocking: boolean;
	description: string;
	detail: string;
	detailMessage?: SetupDetailMessage;
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
