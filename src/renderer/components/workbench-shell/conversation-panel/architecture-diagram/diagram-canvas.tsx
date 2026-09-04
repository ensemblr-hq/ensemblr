import { useCallback, useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { DiagramViewportControls } from '@/renderer/hooks/workbench-shell/architecture-diagram/use-diagram-viewport';
import type {
	DiagramFrame as CompiledFrame,
	DiagramLayout,
} from '@/renderer/lib/architecture-diagram';
import { cn } from '@/renderer/lib/utils';
import {
	type ArchitectureDelta,
	toDeltaStatusMap,
} from '@/shared/architecture-diagram';

import { DiagramEdge } from './diagram-edge';
import { DiagramNode } from './diagram-node';

/** The four arrowheads, one per connection variant. */
const ARROW_MARKERS = [
	{ className: 'fill-muted-foreground/50', id: 'architecture-arrow-default' },
	{ className: 'fill-sky-500/80', id: 'architecture-arrow-emphasis' },
	{ className: 'fill-rose-500/80', id: 'architecture-arrow-security' },
	{
		className: 'fill-muted-foreground/70',
		id: 'architecture-arrow-dashed',
	},
] as const;

/**
 * Which node ids sit one edge away from each node, so selecting one can leave
 * its own neighbourhood lit and push the rest of the diagram back.
 * @param layout - The compiled diagram
 * @returns Node id → the ids it shares an edge with, itself included
 */
function buildAdjacency(
	layout: DiagramLayout,
): ReadonlyMap<string, ReadonlySet<string>> {
	const adjacency = new Map<string, Set<string>>();
	const link = (from: string, to: string) => {
		const existing = adjacency.get(from) ?? new Set([from]);
		existing.add(to);
		adjacency.set(from, existing);
	};
	for (const node of layout.nodes) {
		link(node.id, node.id);
	}
	for (const edge of layout.edges) {
		link(edge.connection.from, edge.connection.to);
		link(edge.connection.to, edge.connection.from);
	}
	return adjacency;
}

/**
 * One boundary: a rectangle under the grid, and the closed curve the organic
 * mode solved under Euler placement.
 *
 * A lens — a set that crosses the regions rather than nesting inside one — is
 * drawn unfilled and on a longer dash, because the only thing that makes an
 * overlap readable is being able to see both curves through it.
 */
function BoundaryFrame({ frame }: { frame: CompiledFrame }) {
	const isSecurity = frame.boundary.kind === 'security-group';
	return (
		<g>
			{frame.outline ? (
				<path
					className={cn(
						frame.isLens
							? 'fill-none'
							: isSecurity
								? 'fill-rose-500/5 stroke-rose-500/40'
								: 'fill-muted/25 stroke-border/60',
						frame.isLens &&
							(isSecurity ? 'stroke-rose-500/70' : 'stroke-border'),
					)}
					d={frame.outline}
					strokeDasharray={frame.isLens ? '7 5' : '3 3'}
					strokeWidth={frame.isLens ? 1.5 : 1}
				/>
			) : (
				<rect
					className='fill-muted/25 stroke-border/60'
					height={frame.height}
					rx={isSecurity ? 8 : 12}
					strokeDasharray='3 3'
					strokeWidth={1}
					width={frame.width}
					x={frame.x}
					y={frame.y}
				/>
			)}
			<text
				className={cn(
					'font-semibold',
					isSecurity ? 'fill-rose-500' : 'fill-muted-foreground',
				)}
				fontSize={10}
				x={frame.title.x}
				y={frame.title.y + 12}
			>
				{frame.boundary.label}
			</text>
		</g>
	);
}

/**
 * The diagram itself. Paint order is load-bearing and matches archify's:
 * boundary frames, then edges, then nodes — so an edge passes behind the boxes
 * it connects rather than across their text.
 *
 * Panning and zooming move one transform on the drawing group and never
 * re-route anything, which is why the compiled layout can be handed in already
 * memoized rather than recomputed per frame.
 */
export function DiagramCanvas({
	delta,
	layout,
	onOpenSource,
	title,
	viewport,
}: {
	delta: ArchitectureDelta;
	layout: DiagramLayout;
	onOpenSource: ((path: string) => void) | null;
	title: string;
	viewport: DiagramViewportControls;
}) {
	const { t } = useTranslation();
	const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
	const adjacency = useMemo(() => buildAdjacency(layout), [layout]);
	const nodeDelta = useMemo(
		() => toDeltaStatusMap(delta.components),
		[delta.components],
	);
	const edgeDelta = useMemo(
		() => toDeltaStatusMap(delta.connections),
		[delta.connections],
	);
	const focused = selectedNodeId ? adjacency.get(selectedNodeId) : null;
	const hintId = useId();
	const clearSelection = useCallback(() => setSelectedNodeId(null), []);
	const { onKeyDown, onPointerDown, view } = viewport;

	return (
		<svg
			aria-describedby={hintId}
			aria-label={t(
				'workbench:architecture-diagram.canvas.label',
				'Architecture diagram of {{title}}',
				{ title },
			)}
			className={cn(
				'size-full touch-none select-none outline-none',
				viewport.isPanning ? 'cursor-grabbing' : 'cursor-grab',
			)}
			onClick={(event) => {
				if (event.target === event.currentTarget) {
					clearSelection();
				}
			}}
			onKeyDown={(event) => {
				if (event.key === 'Escape') {
					clearSelection();
					return;
				}
				onKeyDown(event);
			}}
			onPointerDown={onPointerDown}
			role='application'
			// biome-ignore lint/a11y/noNoninteractiveTabindex: the rule reads <svg> as non-interactive, but this one is the pan and zoom surface — arrow keys move it and +/- scale it, so it has to be reachable by keyboard.
			tabIndex={0}
		>
			<desc id={hintId}>
				{t(
					'workbench:architecture-diagram.canvas.hint',
					'Drag to pan. Pinch, or hold Command and scroll, to zoom. Select a node to see what it connects to.',
				)}
			</desc>
			<defs>
				{ARROW_MARKERS.map((marker) => (
					<marker
						id={marker.id}
						key={marker.id}
						markerHeight={8}
						markerUnits='userSpaceOnUse'
						markerWidth={11}
						orient='auto'
						refX={10}
						refY={4}
					>
						<polygon className={marker.className} points='0 0, 11 4, 0 8' />
					</marker>
				))}
			</defs>
			<g transform={`translate(${view.x} ${view.y}) scale(${view.zoom})`}>
				{layout.frames.map((frame) => (
					<BoundaryFrame frame={frame} key={frame.id} />
				))}
				{layout.edges.map((edge) => (
					<DiagramEdge
						deltaStatus={edgeDelta.get(edge.id) ?? null}
						edge={edge}
						isDimmed={Boolean(
							focused &&
								!(
									focused.has(edge.connection.from) &&
									focused.has(edge.connection.to)
								),
						)}
						key={edge.id}
					/>
				))}
				{layout.nodes.map((node) => (
					<DiagramNode
						deltaStatus={nodeDelta.get(node.id) ?? null}
						isDimmed={Boolean(focused && !focused.has(node.id))}
						isSelected={selectedNodeId === node.id}
						key={node.id}
						node={node}
						onOpenSource={onOpenSource}
						onSelect={setSelectedNodeId}
					/>
				))}
			</g>
		</svg>
	);
}
