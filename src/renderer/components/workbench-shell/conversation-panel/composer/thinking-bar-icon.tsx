import { cn } from '@/renderer/lib/utils';

/** Discrete thinking-effort strength from 0 (off) to 5 (extra-high). */
export type ThinkingBarStrength = 0 | 1 | 2 | 3 | 4 | 5;

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

const STRENGTH_BY_LEVEL: Record<string, ThinkingBarStrength> = {
	'extra-high': 5,
	'extra high': 5,
	high: 4,
	low: 2,
	medium: 3,
	minimal: 1,
	none: 0,
	off: 0,
	xhigh: 5,
};

/**
 * Map a thinking-level label to its bar strength, defaulting to medium (3) for unknown levels.
 * @param level - The thinking-level id, or null when none is set.
 * @returns The matching bar strength (0 when no level is set).
 */
export function getThinkingStrength(level: string | null): ThinkingBarStrength {
	if (!level) {
		return 0;
	}
	const key = level.toLowerCase();
	return STRENGTH_BY_LEVEL[key] ?? 3;
}
