/**
 * The mark a pending approval leads with: the tool's own timeline glyph, so the
 * call the user is deciding about wears the same icon it will wear in the
 * transcript a moment later.
 */
import { GLYPH_ICONS } from '@/renderer/components/tool-collapsible/glyph-icons';
import { glyphForToolName } from '@/renderer/lib/agent-timeline';
import { cn } from '@/renderer/lib/utils';

/**
 * Tools that only look. Everything outside this set — including a tool the app
 * has never seen — is tinted as a change, because an unrecognised name is the
 * one most worth a second look, not the least.
 */
const READ_ONLY_TOOLS: ReadonlySet<string> = new Set([
	'glob',
	'grep',
	'list_directory',
	'ls',
	'lsp_diagnostics',
	'read',
	'read_file',
	'search',
	'view',
]);

/** Renders the tinted icon tile identifying the tool awaiting approval. */
export function ApprovalMark({ toolName }: { toolName: string }) {
	const Icon = GLYPH_ICONS[glyphForToolName(toolName)];
	const readsOnly = READ_ONLY_TOOLS.has(toolName.toLowerCase());
	return (
		<span
			className={cn(
				'flex size-7 shrink-0 items-center justify-center rounded-lg border',
				readsOnly
					? 'border-accent-strong/25 bg-accent-strong/10 text-accent-strong'
					: 'border-status-warning/25 bg-status-warning/10 text-status-warning',
			)}
		>
			<Icon aria-hidden='true' className='size-3.5' />
		</span>
	);
}
