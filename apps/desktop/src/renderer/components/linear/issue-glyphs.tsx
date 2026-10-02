import { useTranslation } from 'react-i18next';

import {
	getLinearPriorityLabel,
	type LinearStateBucket,
} from '@/renderer/lib/linear';
import { cn } from '@/renderer/lib/utils';

/** Bar geometry for the three-bar priority glyph, shortest bar first. */
const PRIORITY_BARS = [
	{ height: 6.5, x: 1.5, y: 8 },
	{ height: 9.5, x: 6.5, y: 5 },
	{ height: 12.5, x: 11.5, y: 2 },
];

/** How many bars each priority number fills, keyed by Linear's own numbering. */
const FILLED_BARS: Record<number, number> = { 2: 3, 3: 2, 4: 1 };

/**
 * Heat ramp per priority, so urgency reads before the shape does: red, amber,
 * soft amber, blue, grey. The bar count still carries the value on its own, so
 * nothing here is encoded by color alone.
 */
const PRIORITY_TONE: Record<number, string> = {
	0: 'text-muted-foreground/50',
	1: 'text-status-danger',
	2: 'text-status-warning',
	3: 'text-status-warning/70',
	4: 'text-accent-strong',
};

/**
 * Linear's priority glyph: a filled square for urgent, otherwise a three-bar
 * meter. A row shows this instead of a priority pill, which read as one more
 * identical badge and told the eye nothing while scanning.
 */
export function LinearPriorityIcon({
	className,
	priority,
}: {
	className?: string;
	priority: number | null;
}) {
	const { t } = useTranslation();
	const level = priority ?? 0;

	return (
		<svg
			aria-label={t('linear:issue-row.priority', 'Priority: {{priority}}', {
				priority: getLinearPriorityLabel(priority),
			})}
			className={cn(
				'size-4 shrink-0',
				PRIORITY_TONE[level] ?? PRIORITY_TONE[0],
				className,
			)}
			role='img'
			viewBox='0 0 16 16'
			xmlns='http://www.w3.org/2000/svg'
		>
			{level === 1 ? (
				<UrgentGlyph />
			) : (
				<PriorityBars filled={FILLED_BARS[level]} />
			)}
		</svg>
	);
}

/** Filled square with an exclamation mark, drawn for the urgent priority. */
function UrgentGlyph() {
	return (
		<>
			<rect fill='currentColor' height='14' rx='3' width='14' x='1' y='1' />
			<rect
				fill='var(--background)'
				height='6'
				rx='1'
				width='2'
				x='7'
				y='3.5'
			/>
			<rect fill='var(--background)' height='2' rx='1' width='2' x='7' y='11' />
		</>
	);
}

/**
 * Three ascending bars with the leading `filled` bars solid. Unfilled bars stay
 * visible at low opacity so every priority occupies the same width.
 */
function PriorityBars({ filled = 0 }: { filled?: number }) {
	return (
		<>
			{PRIORITY_BARS.map((bar, index) => (
				<rect
					fill='currentColor'
					height={filled === 0 ? 1.5 : bar.height}
					key={bar.x}
					opacity={index < filled ? 1 : 0.3}
					rx='0.75'
					width='3'
					x={bar.x}
					y={filled === 0 ? 7.25 : bar.y}
				/>
			))}
		</>
	);
}

/**
 * Linear's workflow-state glyph — a ring that fills as work progresses. Purely
 * decorative: every surface that draws it also names the state in text.
 */
export function LinearStateIcon({
	bucket,
	className,
	color,
}: {
	bucket: LinearStateBucket;
	className?: string;
	color?: string | null;
}) {
	return (
		<svg
			aria-hidden='true'
			className={cn('size-3.5 shrink-0', className)}
			style={{ color: color ?? 'var(--muted-foreground)' }}
			viewBox='0 0 14 14'
			xmlns='http://www.w3.org/2000/svg'
		>
			<StateGlyph bucket={bucket} />
		</svg>
	);
}

/** The ring, fill, and mark that distinguish one state bucket from the next. */
function StateGlyph({ bucket }: { bucket: LinearStateBucket }) {
	if (bucket === 'completed' || bucket === 'canceled') {
		return (
			<>
				<circle cx='7' cy='7' fill='currentColor' r='6' />
				<path
					d={
						bucket === 'completed'
							? 'M4.4 7.2 6.2 9 9.7 5.2'
							: 'M4.9 4.9 9.1 9.1M9.1 4.9 4.9 9.1'
					}
					fill='none'
					stroke='var(--background)'
					strokeLinecap='round'
					strokeLinejoin='round'
					strokeWidth='1.6'
				/>
			</>
		);
	}

	return (
		<>
			<circle
				cx='7'
				cy='7'
				fill='none'
				r='5'
				stroke='currentColor'
				strokeDasharray={bucket === 'backlog' ? '2.6 2.4' : undefined}
				strokeLinecap='round'
				strokeWidth='2'
			/>
			{bucket === 'started' ? (
				<path d='M7 3.5A3.5 3.5 0 0 1 7 10.5Z' fill='currentColor' />
			) : null}
			{bucket === 'triage' ? (
				<>
					<rect
						fill='currentColor'
						height='3.5'
						rx='0.75'
						width='1.5'
						x='6.25'
						y='3.6'
					/>
					<rect
						fill='currentColor'
						height='1.5'
						rx='0.75'
						width='1.5'
						x='6.25'
						y='8.6'
					/>
				</>
			) : null}
		</>
	);
}
