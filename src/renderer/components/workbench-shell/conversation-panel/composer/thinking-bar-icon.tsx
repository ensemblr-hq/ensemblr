import { cn } from '@/renderer/lib/utils';
import type { ThinkingBarStrength } from '@/renderer/types/workbench';

/** Five progressive bars (off=0, minimal=1, low=2, medium=3, high=4, xhigh=5). */
const BAR_WIDTH = 2.2;
const BAR_GAP = 0.6;
const BAR_X_START = 0.6;
const BAR_HEIGHTS = [3, 5, 7, 9, 11] as const;
const BAR_BASELINE_Y = 12;
const ICON_WIDTH =
	BAR_X_START * 2 +
	BAR_HEIGHTS.length * BAR_WIDTH +
	(BAR_HEIGHTS.length - 1) * BAR_GAP;

/** Renders five progressive bars illustrating the selected thinking strength. */
export function ThinkingBarIcon({
	className,
	strength,
}: {
	className?: string;
	strength: ThinkingBarStrength;
}) {
	return (
		<svg
			aria-hidden='true'
			className={cn('h-3.5 w-auto', className)}
			fill='none'
			height='14'
			role='img'
			viewBox={`0 0 ${ICON_WIDTH} 14`}
			width={ICON_WIDTH}
			xmlns='http://www.w3.org/2000/svg'
		>
			<title>Thinking level</title>
			{BAR_HEIGHTS.map((height, index) => {
				const active = index < strength;
				const x = BAR_X_START + index * (BAR_WIDTH + BAR_GAP);
				const y = BAR_BASELINE_Y - height;
				return (
					<rect
						className={
							active ? 'fill-current opacity-100' : 'fill-current opacity-25'
						}
						height={height}
						key={x}
						rx='0.6'
						width={BAR_WIDTH}
						x={x}
						y={y}
					/>
				);
			})}
		</svg>
	);
}
