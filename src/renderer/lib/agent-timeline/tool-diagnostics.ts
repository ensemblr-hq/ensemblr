import type {
	ToolDiagnosticEntry,
	ToolDiagnosticSeverity,
} from '@/renderer/types/tool-presentation';

/**
 * LSP numeric severities, which the protocol orders most-severe-first starting
 * at 1. Pi forwards the server's value untouched.
 */
const SEVERITY_BY_CODE: Record<number, ToolDiagnosticSeverity> = {
	1: 'error',
	2: 'warning',
	3: 'info',
	4: 'hint',
};

const SEVERITY_BY_NAME: Record<string, ToolDiagnosticSeverity> = {
	error: 'error',
	hint: 'hint',
	info: 'info',
	information: 'info',
	warn: 'warning',
	warning: 'warning',
};

/** Ranks severities so the worst diagnostics surface first in a long list. */
const SEVERITY_RANK: Record<ToolDiagnosticSeverity, number> = {
	error: 0,
	hint: 3,
	info: 2,
	warning: 1,
};

/**
 * Narrows a value to a non-array object record.
 * @param value - The value to test
 * @returns True when `value` is a plain object
 */
function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Reads the first non-empty string among the given keys.
 * @param bag - Record to read from
 * @param keys - Keys to try, in order
 * @returns The first non-empty string value, or null when none match
 */
function stringField(
	bag: Record<string, unknown>,
	...keys: string[]
): string | null {
	for (const key of keys) {
		const value = bag[key];
		if (typeof value === 'string' && value.length > 0) {
			return value;
		}
	}
	return null;
}

/**
 * Resolves a diagnostic severity from either its LSP numeric code or its name.
 * @param value - The raw severity field
 * @returns The matching severity, defaulting to `error` when unrecognized
 */
function toSeverity(value: unknown): ToolDiagnosticSeverity {
	if (typeof value === 'number') {
		return SEVERITY_BY_CODE[value] ?? 'error';
	}
	if (typeof value === 'string') {
		return SEVERITY_BY_NAME[value.toLowerCase()] ?? 'error';
	}
	return 'error';
}

/**
 * Extracts the 1-based line and column from an LSP range, which is 0-based.
 * @param diagnostic - One raw diagnostic record
 * @returns The display line and column, each null when the payload omits it
 */
function toPosition(diagnostic: Record<string, unknown>): {
	column: number | null;
	line: number | null;
} {
	const range = isRecord(diagnostic.range) ? diagnostic.range : null;
	const start = range && isRecord(range.start) ? range.start : null;
	const line = typeof start?.line === 'number' ? start.line + 1 : null;
	const column =
		typeof start?.character === 'number' ? start.character + 1 : null;
	return { column, line };
}

/**
 * Reads Pi's `lsp_diagnostics` details bag into render-ready entries, sorted
 * worst-first then by position.
 *
 * Every field is optional in practice: language servers vary, and Pi forwards
 * whatever they emit. Anything without a message is dropped rather than
 * rendered as a blank row.
 * @param details - The `details` bag from an `lsp_diagnostics` result
 * @returns The parsed diagnostics, empty when the payload carries none
 */
export function parseToolDiagnostics(
	details: Readonly<Record<string, unknown>> | null,
): ToolDiagnosticEntry[] {
	if (!details || !Array.isArray(details.diagnostics)) {
		return [];
	}
	const entries: ToolDiagnosticEntry[] = [];
	for (const raw of details.diagnostics) {
		if (!isRecord(raw)) {
			continue;
		}
		const message = stringField(raw, 'message', 'text');
		if (message === null) {
			continue;
		}
		const { column, line } = toPosition(raw);
		entries.push({
			column,
			line,
			message,
			severity: toSeverity(raw.severity),
			source: stringField(raw, 'source', 'code'),
		});
	}
	return entries.sort(compareDiagnostics);
}

/**
 * Orders diagnostics by severity, then by position within the file.
 * @param a - Left diagnostic
 * @param b - Right diagnostic
 * @returns A negative, zero, or positive sort weight
 */
function compareDiagnostics(
	a: ToolDiagnosticEntry,
	b: ToolDiagnosticEntry,
): number {
	const bySeverity = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
	if (bySeverity !== 0) {
		return bySeverity;
	}
	return (a.line ?? 0) - (b.line ?? 0) || (a.column ?? 0) - (b.column ?? 0);
}
