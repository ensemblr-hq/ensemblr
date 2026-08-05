import { useEffect, useRef, useState } from 'react';

import { cn } from '@/renderer/lib/utils';

/** The uniform control height the header row is held to: 1.75rem at 16px root. */
const MAX_CONTROL_HEIGHT_PX = 28;

/** Selector for the interactive controls whose heights have to agree. */
const CONTROL_SELECTOR = 'button, a[href], [role="status"], output';

/**
 * Distinct rendered heights of every control under the returned ref, rounded to
 * whole pixels and sorted.
 *
 * Watching the subtree rather than taking a caller-supplied token keeps the
 * measurement honest: the scene's toggles swap controls in and out without
 * resizing the row that holds them, and a stale token would report the previous
 * row's heights as if they were current.
 * @returns The distinct control heights, and the ref to attach to the row.
 */
function useControlHeights(): {
	heights: number[];
	ref: React.RefObject<HTMLDivElement | null>;
} {
	const ref = useRef<HTMLDivElement>(null);
	const [heights, setHeights] = useState<number[]>([]);

	useEffect(() => {
		const root = ref.current;
		if (!root) {
			return;
		}

		const measure = () => {
			const measured = new Set<number>();
			for (const control of root.querySelectorAll(CONTROL_SELECTOR)) {
				const { height } = control.getBoundingClientRect();
				if (height > 0) {
					measured.add(Math.round(height));
				}
			}
			const next = [...measured].sort((a, b) => a - b);
			setHeights((previous) =>
				isSameHeights(previous, next) ? previous : next,
			);
		};

		measure();
		const resizeObserver = new ResizeObserver(measure);
		resizeObserver.observe(root);
		const mutationObserver = new MutationObserver(measure);
		mutationObserver.observe(root, {
			attributeFilter: ['class', 'style'],
			attributes: true,
			childList: true,
			subtree: true,
		});

		return () => {
			resizeObserver.disconnect();
			mutationObserver.disconnect();
		};
	}, []);

	return { heights, ref };
}

/**
 * Wraps a header row and reports the heights it actually rendered, so "all
 * buttons are 1.75rem" is checked against the DOM instead of by eye. The badge
 * turns red when the row disagrees with itself or exceeds the cap.
 */
export function MeasuredRow({
	children,
	label,
	note,
}: {
	children: React.ReactNode;
	label: string;
	note?: string;
}) {
	const { heights, ref } = useControlHeights();

	return (
		<section className='flex flex-col gap-1.5'>
			<div className='flex items-baseline gap-2'>
				<h3 className='font-mono text-muted-foreground text-xxs uppercase tracking-wide'>
					{label}
				</h3>
				{note ? (
					<span className='truncate text-muted-foreground text-xxs'>
						{note}
					</span>
				) : null}
				<HeightBadge heights={heights} />
			</div>
			<div ref={ref}>{children}</div>
		</section>
	);
}

/** Verdict pill for one row's measurement: green only when uniform and capped. */
function HeightBadge({ heights }: { heights: number[] }) {
	const isPassing =
		heights.length <= 1 &&
		heights.every((height) => height <= MAX_CONTROL_HEIGHT_PX);

	return (
		<span
			className={cn(
				'ml-auto shrink-0 rounded-sm border px-1.5 py-0.5 font-mono text-xxs',
				heights.length === 0 && 'border-border text-muted-foreground',
				heights.length > 0 &&
					(isPassing
						? 'border-status-ok/40 text-status-ok'
						: 'border-status-danger/40 text-status-danger'),
			)}
		>
			{formatHeights(heights)}
		</span>
	);
}

/**
 * Whether two measurements agree, so an unchanged row does not re-render on
 * every observer callback.
 * @param previous - Heights currently held in state.
 * @param next - Heights just measured.
 * @returns True when the two lists are equal.
 */
function isSameHeights(previous: number[], next: number[]): boolean {
	return (
		previous.length === next.length &&
		previous.every((value, index) => value === next[index])
	);
}

/**
 * Renders measured heights as a badge, naming the failure rather than only
 * printing numbers.
 * @param heights - Distinct control heights in pixels.
 * @returns Badge text for the row.
 */
function formatHeights(heights: number[]): string {
	if (heights.length === 0) {
		return 'no controls';
	}

	const rendered = heights
		.map((height) => `${height.toString()}px`)
		.join(' / ');
	if (heights.length > 1) {
		return `${rendered} — mixed`;
	}
	return heights[0] > MAX_CONTROL_HEIGHT_PX
		? `${rendered} — over 1.75rem`
		: `${rendered} = ${(heights[0] / 16).toString()}rem`;
}
