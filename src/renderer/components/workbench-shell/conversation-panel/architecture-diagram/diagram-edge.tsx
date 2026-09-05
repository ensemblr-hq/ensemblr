import { memo, useState } from 'react';
import type { DiagramEdge as RoutedEdge } from '@/renderer/lib/architecture-diagram';
import { cn } from '@/renderer/lib/utils';
import type {
	ArchitectureConnectionVariant,
	ArchitectureDeltaStatus,
} from '@/shared/architecture-diagram';

import { CONNECTION_TONE, DELTA_TONE, EDGE_HIT_WIDTH } from './diagram-tokens';

/**
 * Marker id an edge points at, per variant. Keyed by the union so a new variant
 * is a compile error here rather than an arrowhead that silently goes missing.
 */
const MARKER_ID: Record<ArchitectureConnectionVariant, string> = {
	dashed: 'architecture-arrow-dashed',
	default: 'architecture-arrow-default',
	emphasis: 'architecture-arrow-emphasis',
	security: 'architecture-arrow-security',
};

/**
 * One routed import relationship. A changed edge is redrawn once underneath in
 * the delta colour rather than recoloured, so the variant it belongs to stays
 * readable while the badge still shows.
 *
 * Hover runs off an invisible band rather than the drawn line: at a stroke
 * width chosen to be legible next to fifty boxes, the line itself is far too
 * thin to be a pointer target.
 */
export const DiagramEdge = memo(function DiagramEdge({
	deltaStatus,
	edge,
	isDimmed,
}: {
	deltaStatus: ArchitectureDeltaStatus | null;
	edge: RoutedEdge;
	/** True while a node selection has pushed this edge into the background. */
	isDimmed: boolean;
}) {
	const [isHovered, setIsHovered] = useState(false);
	const variant = edge.connection.variant ?? 'default';
	const tone = CONNECTION_TONE[variant];
	const label = edge.connection.label;

	return (
		<g
			className={cn(
				'transition-opacity duration-150',
				isDimmed && !isHovered && 'opacity-15',
			)}
			data-delta={deltaStatus ?? undefined}
			data-dimmed={isDimmed && !isHovered ? 'true' : undefined}
			data-edge-id={edge.id}
			onPointerEnter={() => setIsHovered(true)}
			onPointerLeave={() => setIsHovered(false)}
		>
			<path
				className='fill-none stroke-transparent'
				d={edge.d}
				strokeWidth={EDGE_HIT_WIDTH}
			/>
			{deltaStatus ? (
				<path
					className={cn('fill-none', DELTA_TONE[deltaStatus])}
					d={edge.d}
					strokeOpacity={0.35}
					strokeWidth={4}
				/>
			) : null}
			<path
				className={cn(
					'fill-none transition-[stroke-width]',
					isHovered ? 'stroke-foreground' : tone.stroke,
				)}
				d={edge.d}
				markerEnd={`url(#${MARKER_ID[variant]})`}
				strokeDasharray={tone.dashArray}
				strokeWidth={isHovered ? tone.width + 1 : tone.width}
			/>
			{edge.labelAt && label ? (
				<EdgeLabel at={edge.labelAt} isHovered={isHovered} text={label} />
			) : null}
		</g>
	);
});

/**
 * An edge's label, plated so it reads over whatever the edge happens to cross.
 * The plate is sized from the text's own advance width rather than measured,
 * which keeps the whole surface renderable without a DOM.
 */
function EdgeLabel({
	at,
	isHovered,
	text,
}: {
	at: readonly [number, number];
	isHovered: boolean;
	text: string;
}) {
	const fontSize = 9;
	const width = text.length * fontSize * 0.55 + 8;
	return (
		<>
			<rect
				className='fill-background/85'
				height={fontSize + 4}
				rx={3}
				width={width}
				x={at[0] - width / 2}
				y={at[1] - fontSize}
			/>
			<text
				className={cn(
					isHovered ? 'fill-foreground' : 'fill-muted-foreground',
					'transition-colors',
				)}
				fontSize={fontSize}
				textAnchor='middle'
				x={at[0]}
				y={at[1]}
			>
				{text}
			</text>
		</>
	);
}
