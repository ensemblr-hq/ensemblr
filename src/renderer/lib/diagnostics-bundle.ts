import type {
	SetupCheckLogSnapshot,
	SetupCheckSnapshot,
	SetupDiagnosticsSnapshot,
	SetupRemediationAction,
} from '@/shared/ipc/contracts/setup';

const SECRET_KEY_PATTERN =
	/(token|secret|password|api[_-]?key|bearer|authorization|cookie)/i;
const HOME_PATH_PATTERN = /\/Users\/[^/\s'"]+/g;
const EMAIL_PATTERN = /[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi;
const JWT_LIKE_PATTERN =
	/\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;
const HEX_TOKEN_PATTERN = /\b[a-f0-9]{32,}\b/gi;

/**
 * Returns a copy of the setup-diagnostics snapshot with sensitive substrings
 * masked. Use before exporting / copying logs out of the app. The replacement
 * keeps the original key shape so post-export grep remains useful, but the
 * sensitive value is replaced with `***`.
 *
 * Every free-text string field is enumerated explicitly. Do NOT use spread
 * (`...check`, `...log`) here: a future field on the IPC shape would silently
 * bypass sanitization. If you add a string field upstream, also add it here.
 */
export function sanitizeDiagnosticsBundle(
	snapshot: SetupDiagnosticsSnapshot,
): SetupDiagnosticsSnapshot {
	return {
		blockedCount: snapshot.blockedCount,
		checks: snapshot.checks.map(sanitizeCheck),
		generatedAt: snapshot.generatedAt,
		optionalCount: snapshot.optionalCount,
		requiredCount: snapshot.requiredCount,
		status: snapshot.status,
		successCount: snapshot.successCount,
		warningCount: snapshot.warningCount,
	};
}

/**
 * Returns a copy of a setup check snapshot with its text, logs, and remediation actions sanitized.
 * @param check - Setup check snapshot to sanitize
 * @returns The sanitized check snapshot
 */
function sanitizeCheck(check: SetupCheckSnapshot): SetupCheckSnapshot {
	return {
		blocking: check.blocking,
		description: sanitizeText(check.description),
		detail: sanitizeText(check.detail),
		group: check.group,
		id: check.id,
		logs: check.logs.map(sanitizeLog),
		remediationActions: check.remediationActions.map(sanitizeRemediation),
		status: check.status,
		title: sanitizeText(check.title),
		updatedAt: check.updatedAt,
	};
}

/**
 * Returns a copy of a setup check log snapshot with its label and text sanitized.
 * @param log - Log snapshot to sanitize
 * @returns The sanitized log snapshot
 */
function sanitizeLog(log: SetupCheckLogSnapshot): SetupCheckLogSnapshot {
	return {
		label: sanitizeText(log.label),
		text: sanitizeText(log.text),
		truncated: log.truncated,
	};
}

/**
 * Returns a copy of a remediation action with its command, label, and target sanitized.
 * @param action - Remediation action to sanitize
 * @returns The sanitized remediation action
 */
function sanitizeRemediation(
	action: SetupRemediationAction,
): SetupRemediationAction {
	return {
		command: action.command ? sanitizeText(action.command) : action.command,
		id: action.id,
		kind: action.kind,
		label: sanitizeText(action.label),
		target: action.target ? sanitizeText(action.target) : action.target,
	};
}

/**
 * Redacts secrets and PII (JWTs, hex tokens, emails, home paths, and key/value secrets) from a string.
 * @param input - Text to sanitize
 * @returns The sanitized text
 */
function sanitizeText(input: string): string {
	if (!input) return input;
	let next = input;
	next = next.replace(JWT_LIKE_PATTERN, '***');
	next = next.replace(HEX_TOKEN_PATTERN, '***');
	next = next.replace(EMAIL_PATTERN, '***@***');
	next = next.replace(HOME_PATH_PATTERN, '/Users/~');
	next = next.replace(
		/("?[\w-]*(?:token|secret|password|api[_-]?key|bearer|authorization|cookie)[\w-]*"?\s*[:=]\s*)"[^"\s]+"/gi,
		(_match, prefix) => `${prefix}"***"`,
	);
	// Replace bare assignments like FOO_TOKEN=value
	next = next.replace(
		new RegExp(
			`((?:\\w*${SECRET_KEY_PATTERN.source}\\w*)\\s*[:=]\\s*)([^\\s'"]+)`,
			'gi',
		),
		(_match, prefix) => `${prefix}***`,
	);
	return next;
}
