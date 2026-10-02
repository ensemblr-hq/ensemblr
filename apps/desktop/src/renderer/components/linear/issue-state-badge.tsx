import { Badge } from '@/renderer/components/ui/badge';
import { resolveLinearStateBucket } from '@/renderer/lib/linear';

import { LinearStateIcon } from './issue-glyphs';

/** Workflow-state glyph + name badge, drawn in the state's own Linear color. */
export function LinearStateBadge({
	color,
	name,
	stateType,
}: {
	color: string | null;
	name: string | null;
	stateType: string | null;
}) {
	if (!name) {
		return null;
	}

	return (
		<Badge variant='outline'>
			<LinearStateIcon
				bucket={resolveLinearStateBucket({ stateType })}
				className='size-3'
				color={color}
			/>
			{name}
		</Badge>
	);
}
