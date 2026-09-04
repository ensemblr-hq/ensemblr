import type { DiagramEdge as RoutedEdge } from '@/renderer/lib/architecture-diagram';
import { cn } from '@/renderer/lib/utils';
import type { ArchitectureDeltaStatus } from '@/shared/architecture-diagram';

import { CONNECTION_TONE, DELTA_TONE } from './diagram-tokens';

/** Marker id an edge points at, per variant. */
const MARKER_ID: Record<string, string> = {
	dashed: 'architecture-arrow-dashed',
	default: 'architecture-arrow-default',
	emphasis: 'architecture-arrow-emphasis',
	security: 'architecture-arrow-security',
};

/**
 * One routed import relationship. A changed edge is redrawn once underneath in
 * the delta colour rather than recoloured, so the variant it belongs to stays
 * readable while the badge still shows.
 */
export function DiagramEdge({
	deltaStatus,
	edge,
}: {
	deltaStatus: ArchitectureDeltaStatus | null;
	edge: RoutedEdge;
}) {
	const variant = edge.connection.variant ?? 'default';
	const tone = CONNECTION_TONE[variant];
	return (
		<g>
			{deltaStatus ? (
				<path
					className={cn('fill-none', DELTA_TONE[deltaStatus])}
					d={edge.d}
					strokeWidth={4}
					strokeOpacity={0.35}
				/>
			) : null}
			<path
				className={cn('fill-none', tone.stroke)}
				d={edge.d}
				markerEnd={`url(#${MARKER_ID[variant]})`}
				strokeDasharray={tone.dashArray}
				strokeWidth={1.25}
			/>
			{edge.labelAt && edge.connection.label ? (
				<text
					className='fill-muted-foreground'
					fontSize={8}
					textAnchor='middle'
					x={edge.labelAt[0]}
					y={edge.labelAt[1]}
				>
					{edge.connection.label}
				</text>
			) : null}
		</g>
	);
}
