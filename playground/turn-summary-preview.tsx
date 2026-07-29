import { ChatTurnSummary } from '@/renderer/components/chat-turn-summary';
import type { ToolGlyph } from '@/renderer/types/tool-presentation';

const SHORT_TURN: ToolGlyph[] = ['terminal', 'file-text', 'file-pen'];

const REFERENCE_TURN: ToolGlyph[] = [
	'terminal',
	'file-text',
	'file-pen',
	'file-pen',
	'wrench',
	'wrench',
	'wrench',
	'wrench',
	'wrench',
];

const LONG_TURN: ToolGlyph[] = Array.from({ length: 62 }, (_value, index) => {
	const cycle: ToolGlyph[] = [
		'search',
		'file-text',
		'terminal',
		'file-pen',
		'folder-tree',
		'stethoscope',
		'circle-x',
	];
	return cycle[index % cycle.length] ?? 'wrench';
});

/**
 * The collapsed turn toggle at the three shapes that matter: a handful of
 * calls, the reference mock's mix, and a turn long enough to overflow the
 * strip. Click any row to confirm the strip yields to the expanded rows.
 */
export function TurnSummaryPreview() {
	return (
		<div className='flex flex-col gap-8'>
			<ChatTurnSummary
				durationMs={null}
				messageCount={2}
				toolGlyphs={SHORT_TURN}
			>
				<div className='text-muted-foreground text-sm'>folded rows go here</div>
			</ChatTurnSummary>

			<ChatTurnSummary
				durationMs={null}
				messageCount={24}
				toolGlyphs={REFERENCE_TURN}
			>
				<div className='text-muted-foreground text-sm'>folded rows go here</div>
			</ChatTurnSummary>

			<ChatTurnSummary
				durationMs={94_000}
				messageCount={24}
				toolGlyphs={LONG_TURN}
			>
				<div className='text-muted-foreground text-sm'>folded rows go here</div>
			</ChatTurnSummary>

			<ChatTurnSummary durationMs={null} messageCount={0} toolGlyphs={[]}>
				<div className='text-muted-foreground text-sm'>folded rows go here</div>
			</ChatTurnSummary>
		</div>
	);
}
