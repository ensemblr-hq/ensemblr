import { useTranslation } from 'react-i18next';
import type {
	ConciergeResizableSurface,
	ConciergeResizeEdge,
} from '@/renderer/hooks/concierge/use-concierge-resize';
import { cn } from '@/renderer/lib/utils';

/**
 * Every grip, placed and cursored by the edges it moves.
 *
 * The edge strips stop short of the corners so the corner grips win there,
 * which is what makes a diagonal drag possible at all — an edge strip running
 * the full side would cover the corner it meets and offer only one axis.
 *
 * Each cursor is marked important because `index.css` gives every enabled
 * button `cursor-pointer` from `button:not(:disabled)`, which out-specifies a
 * bare utility class and would leave all eight grips reading as ordinary
 * buttons.
 */
const GRIPS: readonly {
	className: string;
	edge: ConciergeResizeEdge;
}[] = [
	{ className: 'inset-x-4 top-0 h-2 cursor-ns-resize!', edge: 'top' },
	{ className: 'inset-x-4 bottom-0 h-2 cursor-ns-resize!', edge: 'bottom' },
	{ className: 'inset-y-4 left-0 w-2 cursor-ew-resize!', edge: 'left' },
	{ className: 'inset-y-4 right-0 w-2 cursor-ew-resize!', edge: 'right' },
	{
		className: 'top-0 left-0 size-4 cursor-nwse-resize!',
		edge: 'top-left',
	},
	{
		className: 'top-0 right-0 size-4 cursor-nesw-resize!',
		edge: 'top-right',
	},
	{
		className: 'bottom-0 left-0 size-4 cursor-nesw-resize!',
		edge: 'bottom-left',
	},
	{
		className: 'right-0 bottom-0 size-4 cursor-nwse-resize!',
		edge: 'bottom-right',
	},
];

/**
 * The docked panel's resize grips: all four edges and all four corners, each
 * cursored for the axes it moves.
 *
 * They carry no visible rule of their own — the cursor is the affordance, as it
 * is on a window edge — so the panel's border stays a single line.
 *
 * Only the bottom-right corner is reachable by keyboard, and it is the one that
 * carries the label. Eight identical tab stops would be noise, and that corner
 * is the conventional grip: arrow keys grow the panel away from the header the
 * user is holding it by. The other seven are pointer affordances and say so.
 */
export function ConciergeResizeHandles({
	resize,
}: {
	resize: ConciergeResizableSurface;
}) {
	const { t } = useTranslation();
	const label = t(
		'workbench:concierge.panel.resize',
		'Resize the Concierge — drag any edge, or use the arrow keys',
	);

	return (
		<>
			{GRIPS.map(({ className, edge }) => {
				const isKeyboardGrip = edge === 'bottom-right';
				return (
					<button
						aria-hidden={isKeyboardGrip ? undefined : 'true'}
						aria-label={isKeyboardGrip ? label : undefined}
						className={cn(
							'absolute z-20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring focus-visible:-outline-offset-2',
							className,
						)}
						key={edge}
						onKeyDown={(event) => resize.nudge(edge, event)}
						onPointerDown={(event) => {
							event.stopPropagation();
							resize.start(edge, event);
						}}
						tabIndex={isKeyboardGrip ? undefined : -1}
						title={isKeyboardGrip ? label : undefined}
						type='button'
					/>
				);
			})}
		</>
	);
}
