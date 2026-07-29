import { cn } from '@/renderer/lib/utils';
import type {
	ToolDiagnosticEntry,
	ToolDiagnosticSeverity,
} from '@/renderer/types/tool-presentation';
import { ToolPanel } from './tool-panel';

const SEVERITY_COLOR: Record<ToolDiagnosticSeverity, string> = {
	error: 'text-status-danger',
	hint: 'opacity-40',
	info: 'opacity-60',
	warning: 'text-status-warning',
};

/**
 * Body for a language-server report: one row per diagnostic, worst first.
 *
 * Built for this row rather than routed through the generic text body because
 * `lsp_diagnostics` returns structure — severity, position, reporting server —
 * that reads as a table and would collapse into an unscannable JSON dump.
 */
export function ToolDiagnosticsList({
	entries,
}: {
	entries: readonly ToolDiagnosticEntry[];
}) {
	return (
		<ToolPanel>
			<div className='flex flex-col gap-2'>
				{entries.map((entry) => (
					<ToolDiagnosticRow entry={entry} key={diagnosticKey(entry)} />
				))}
			</div>
		</ToolPanel>
	);
}

/**
 * Builds a diagnostic's list key from its own content, so the key survives
 * reordering. Two diagnostics matching on every field are indistinguishable to
 * the reader, so collapsing them onto one key costs nothing.
 * @param entry - The diagnostic to identify
 * @returns A key derived from severity, position, source, and message
 */
function diagnosticKey(entry: ToolDiagnosticEntry): string {
	return `${entry.severity}:${entry.line}:${entry.column}:${entry.source}:${entry.message}`;
}

/** One diagnostic: severity, position, message, then the server that raised it. */
function ToolDiagnosticRow({ entry }: { entry: ToolDiagnosticEntry }) {
	return (
		<div className='flex min-w-0 items-baseline gap-2'>
			<span
				className={cn(
					'w-16 shrink-0 font-medium text-xxs uppercase',
					SEVERITY_COLOR[entry.severity],
				)}
			>
				{entry.severity}
			</span>
			<span className='w-14 shrink-0 text-xxs tabular-nums opacity-40'>
				{formatPosition(entry)}
			</span>
			<span className='wrap-break-word min-w-0 flex-1 whitespace-pre-wrap'>
				{entry.message}
			</span>
			{entry.source ? (
				<span className='shrink-0 text-xxs opacity-40'>{entry.source}</span>
			) : null}
		</div>
	);
}

/**
 * Formats a diagnostic's position as `line:column`, degrading as fields drop out.
 * @param entry - The diagnostic to locate
 * @returns The position label, or an em dash when the payload carries no line
 */
function formatPosition(entry: ToolDiagnosticEntry): string {
	if (entry.line === null) {
		return '—';
	}
	return entry.column === null
		? String(entry.line)
		: `${entry.line}:${entry.column}`;
}
