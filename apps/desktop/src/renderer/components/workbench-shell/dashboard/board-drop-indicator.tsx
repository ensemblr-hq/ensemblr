import type { Edge } from '@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge';

import { cn } from '@/renderer/lib/utils';

/** Thin insertion line shown at a card's top or bottom edge while dragging over it. */
export function BoardDropIndicator({ edge }: { edge: Edge | null }) {
	if (edge !== 'top' && edge !== 'bottom') {
		return null;
	}
	return (
		<div
			aria-hidden='true'
			className={cn(
				'pointer-events-none absolute inset-x-0 h-0.5 rounded-full bg-primary',
				edge === 'top' ? '-top-1' : '-bottom-1',
			)}
		/>
	);
}
