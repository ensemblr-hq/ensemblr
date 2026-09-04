import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { compileArchitectureLayout } from '@/renderer/lib/architecture-diagram';
import { cn } from '@/renderer/lib/utils';
import {
	type ArchitectureDelta,
	type ArchitectureIR,
	toDeltaStatusMap,
} from '@/shared/architecture-diagram';

import { DiagramEdge } from './diagram-edge';
import { DiagramNode } from './diagram-node';

/** The four arrowheads, one per connection variant. */
const ARROW_MARKERS = [
	{ className: 'fill-border', id: 'architecture-arrow-default' },
	{ className: 'fill-sky-500/70', id: 'architecture-arrow-emphasis' },
	{ className: 'fill-rose-500/70', id: 'architecture-arrow-security' },
	{
		className: 'fill-muted-foreground/60',
		id: 'architecture-arrow-dashed',
	},
] as const;

/**
 * The diagram itself. Paint order is load-bearing and matches archify's:
 * boundary frames, then edges, then nodes, then labels — so an edge passes
 * behind the boxes it connects rather than across their text.
 *
 * The layout is compiled here rather than in the panel because the compile is
 * pure and memoizable on the IR alone; a zoom or pan changes only the wrapper's
 * transform and never re-routes anything.
 */
export function DiagramCanvas({
	delta,
	ir,
	onOpenSource,
	zoom,
}: {
	delta: ArchitectureDelta;
	ir: ArchitectureIR;
	onOpenSource: ((path: string) => void) | null;
	zoom: number;
}) {
	const { t } = useTranslation();
	const layout = useMemo(() => compileArchitectureLayout(ir), [ir]);
	const nodeDelta = useMemo(
		() => toDeltaStatusMap(delta.components),
		[delta.components],
	);
	const edgeDelta = useMemo(
		() => toDeltaStatusMap(delta.connections),
		[delta.connections],
	);
	const [viewWidth, viewHeight] = layout.viewBox;

	return (
		<>
			{layout.problems.length > 0 ? (
				<p className='mb-2 text-amber-600 text-xs dark:text-amber-400'>
					{t('workbench:architecture-diagram.problems', {
						count: layout.problems.length,
						defaultValue_one: '{{count}} placement problem in this diagram.',
						defaultValue_other: '{{count}} placement problems in this diagram.',
					})}
				</p>
			) : null}
			<svg
				aria-label={t(
					'workbench:architecture-diagram.canvas.label',
					'Architecture diagram of {{title}}',
					{ title: ir.meta.title },
				)}
				className='select-none'
				height={viewHeight * zoom}
				role='img'
				viewBox={`0 0 ${viewWidth} ${viewHeight}`}
				width={viewWidth * zoom}
			>
				<defs>
					{ARROW_MARKERS.map((marker) => (
						<marker
							id={marker.id}
							key={marker.id}
							markerHeight={7}
							markerWidth={10}
							orient='auto'
							refX={9}
							refY={3.5}
						>
							<polygon className={marker.className} points='0 0, 10 3.5, 0 7' />
						</marker>
					))}
				</defs>
				{layout.frames.map((frame) => (
					<g key={frame.id}>
						<rect
							className='fill-muted/25 stroke-border/60'
							height={frame.height}
							rx={frame.boundary.kind === 'security-group' ? 8 : 12}
							strokeDasharray='3 3'
							strokeWidth={1}
							width={frame.width}
							x={frame.x}
							y={frame.y}
						/>
						<text
							className={cn(
								'font-semibold',
								frame.boundary.kind === 'security-group'
									? 'fill-rose-500'
									: 'fill-muted-foreground',
							)}
							fontSize={9}
							x={frame.title.x}
							y={frame.title.y + 12}
						>
							{frame.boundary.label}
						</text>
					</g>
				))}
				{layout.edges.map((edge) => (
					<DiagramEdge
						deltaStatus={edgeDelta.get(edge.id) ?? null}
						edge={edge}
						key={edge.id}
					/>
				))}
				{layout.nodes.map((node) => (
					<DiagramNode
						deltaStatus={nodeDelta.get(node.id) ?? null}
						key={node.id}
						node={node}
						onOpenSource={onOpenSource}
					/>
				))}
			</svg>
		</>
	);
}
