import {
	type PointerEvent as ReactPointerEvent,
	useCallback,
	useId,
	useMemo,
	useRef,
	useState,
} from 'react';
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
import { boundaryTone } from './diagram-tokens';

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
 * How far the pointer may travel between press and release and still count as a
 * click. Panning ends in a `click` on the background, so without this the drag
 * that brought a neighbour into view would clear the selection it was serving.
 */
const CLICK_SLOP_PX = 4;

/** Physical keys that step the node group, since the arrows already pan. */
const NODE_STEP_CODES: Record<string, number> = {
	KeyN: 1,
	KeyP: -1,
};

/** Everything the canvas draws and the viewport it draws through. */
interface DiagramCanvasProps {
	delta: ArchitectureDelta;
	layout: DiagramLayout;
	onOpenSource: ((path: string) => void) | null;
	title: string;
	viewport: DiagramViewportControls;
}

/** A node's two pre-translated accessible names. */
interface NodeLabels {
	openSource: string | null;
	select: string;
}

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
 * Translates every node's accessible names once per layout rather than once per
 * node render, so a pan — which re-renders the canvas on every pointer event —
 * costs no interpolation at all.
 * @param layout - The compiled diagram
 * @returns Node id → its body and corner-control labels
 */
function useNodeLabels(layout: DiagramLayout): ReadonlyMap<string, NodeLabels> {
	const { t } = useTranslation();
	return useMemo(() => {
		const labels = new Map<string, NodeLabels>();
		for (const node of layout.nodes) {
			const name = node.component.sublabel
				? t(
						'workbench:architecture-diagram.node.name-with-sublabel',
						'{{label}} — {{sublabel}}',
						{ label: node.component.label, sublabel: node.component.sublabel },
					)
				: node.component.label;
			const sourcePath = node.component.sources?.[0]?.path ?? null;
			labels.set(node.id, {
				openSource: sourcePath
					? t(
							'workbench:architecture-diagram.node.open-source',
							'Open {{path}}',
							{ path: sourcePath },
						)
					: null,
				select: t(
					'workbench:architecture-diagram.node.select-label',
					'{{name}} — show what it connects to',
					{ name },
				),
			});
		}
		return labels;
	}, [layout.nodes, t]);
}

/**
 * Keeps one node in the tab order and steps it with N and P.
 *
 * Every node carrying its own tab stop meant a two-hundred-node diagram took
 * four hundred presses to cross. The arrows are already the pan gesture, so the
 * group steps on letter keys — matched by physical key, which is what keeps
 * them reachable on a Russian or Greek layout.
 * @param layout - The compiled diagram, whose node order the stepping follows
 * @returns The node holding the tab stop, and the key handler that moves it
 */
function useRovingNode(layout: DiagramLayout): {
	activeNodeId: string | null;
	onNodeStepKey: (event: {
		code: string;
		currentTarget: SVGSVGElement;
		preventDefault: () => void;
	}) => boolean;
	setActiveNodeId: (nodeId: string) => void;
} {
	const [requestedNodeId, setActiveNodeId] = useState<string | null>(null);
	const firstNodeId = layout.nodes[0]?.id ?? null;
	const activeNodeId =
		requestedNodeId && layout.nodes.some((node) => node.id === requestedNodeId)
			? requestedNodeId
			: firstNodeId;

	const onNodeStepKey = useCallback(
		(event: {
			code: string;
			currentTarget: SVGSVGElement;
			preventDefault: () => void;
		}) => {
			const step = NODE_STEP_CODES[event.code];
			if (!step || layout.nodes.length === 0) {
				return false;
			}
			event.preventDefault();
			const current = layout.nodes.findIndex(
				(node) => node.id === activeNodeId,
			);
			const next =
				layout.nodes[
					(current + step + layout.nodes.length) % layout.nodes.length
				];
			if (!next) {
				return false;
			}
			setActiveNodeId(next.id);
			focusNodeBody(event.currentTarget, next.id);
			return true;
		},
		[activeNodeId, layout.nodes],
	);

	return { activeNodeId, onNodeStepKey, setActiveNodeId };
}

/**
 * Moves keyboard focus onto a node's body without a selector that would have to
 * escape an id the document author chose.
 * @param canvas - The svg the nodes are drawn in
 * @param nodeId - Node whose body should take focus
 */
function focusNodeBody(canvas: SVGSVGElement, nodeId: string): void {
	const group = Array.from(
		canvas.querySelectorAll<SVGGElement>('[data-node-id]'),
	).find((element) => element.dataset.nodeId === nodeId);
	group?.querySelector<SVGGElement>('[role="button"]')?.focus();
}

/**
 * One boundary: a rectangle under the grid, and the closed curve the organic
 * mode solved under Euler placement. Every class it draws with comes from
 * `boundaryTone`, so the eight combinations of lens and security live in one
 * table rather than in nested ternaries here.
 */
function BoundaryFrame({ frame }: { frame: CompiledFrame }) {
	const tone = boundaryTone({
		isLens: Boolean(frame.isLens),
		isSecurity: frame.boundary.kind === 'security-group',
	});
	return (
		<g>
			{frame.outline ? (
				<path
					className={cn(tone.fill, tone.stroke)}
					d={frame.outline}
					strokeDasharray={tone.dashArray}
					strokeWidth={tone.strokeWidth}
				/>
			) : (
				<rect
					className={cn(tone.fill, tone.stroke)}
					height={frame.height}
					rx={tone.rx}
					strokeDasharray={tone.dashArray}
					strokeWidth={tone.strokeWidth}
					width={frame.width}
					x={frame.x}
					y={frame.y}
				/>
			)}
			<text
				className={cn('font-semibold', tone.titleFill)}
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
 * memoized rather than recomputed per frame. The drawing itself is memoized
 * alongside it, so a pan writes a transform and reconciles nothing else.
 */
export function DiagramCanvas({
	delta,
	layout,
	onOpenSource,
	title,
	viewport,
}: DiagramCanvasProps) {
	const { t } = useTranslation();
	const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
	const adjacency = useMemo(() => buildAdjacency(layout), [layout]);
	const nodeLabels = useNodeLabels(layout);
	const { activeNodeId, onNodeStepKey, setActiveNodeId } =
		useRovingNode(layout);
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
	const pressedAtRef = useRef<{ x: number; y: number } | null>(null);
	const { onKeyDown, onPointerDown, view } = viewport;

	const selectNode = useCallback(
		(nodeId: string | null) => {
			setSelectedNodeId(nodeId);
			if (nodeId) {
				setActiveNodeId(nodeId);
			}
		},
		[setActiveNodeId],
	);

	const handlePointerDown = useCallback(
		(event: ReactPointerEvent<SVGSVGElement>) => {
			pressedAtRef.current = { x: event.clientX, y: event.clientY };
			onPointerDown(event);
		},
		[onPointerDown],
	);

	const frames = useMemo(
		() =>
			layout.frames.map((frame) => (
				<BoundaryFrame frame={frame} key={frame.id} />
			)),
		[layout.frames],
	);

	const edges = useMemo(
		() =>
			layout.edges.map((edge) => (
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
			)),
		[edgeDelta, focused, layout.edges],
	);

	const nodes = useMemo(
		() =>
			layout.nodes.map((node) => (
				<DiagramNode
					deltaStatus={nodeDelta.get(node.id) ?? null}
					isActive={activeNodeId === node.id}
					isDimmed={Boolean(focused && !focused.has(node.id))}
					isSelected={selectedNodeId === node.id}
					key={node.id}
					node={node}
					onOpenSource={onOpenSource}
					onSelect={selectNode}
					openSourceLabel={nodeLabels.get(node.id)?.openSource ?? null}
					selectLabel={nodeLabels.get(node.id)?.select ?? node.component.label}
				/>
			)),
		[
			activeNodeId,
			focused,
			layout.nodes,
			nodeDelta,
			nodeLabels,
			onOpenSource,
			selectNode,
			selectedNodeId,
		],
	);

	return (
		<svg
			aria-describedby={hintId}
			aria-label={t(
				'workbench:architecture-diagram.canvas.label',
				'Architecture diagram of {{title}}',
				{ title },
			)}
			className={cn(
				'size-full touch-none select-none outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring focus-visible:-outline-offset-2',
				viewport.isPanning ? 'cursor-grabbing' : 'cursor-grab',
			)}
			onClick={(event) => {
				const pressedAt = pressedAtRef.current;
				pressedAtRef.current = null;
				const travelled = pressedAt
					? Math.hypot(event.clientX - pressedAt.x, event.clientY - pressedAt.y)
					: 0;
				if (
					event.target === event.currentTarget &&
					travelled <= CLICK_SLOP_PX
				) {
					selectNode(null);
				}
			}}
			onKeyDown={(event) => {
				if (event.key === 'Escape') {
					selectNode(null);
					return;
				}
				if (onNodeStepKey(event)) {
					return;
				}
				onKeyDown(event);
			}}
			onPointerDown={handlePointerDown}
			role='application'
			// biome-ignore lint/a11y/noNoninteractiveTabindex: the rule reads <svg> as non-interactive, but this one is the pan and zoom surface — arrow keys move it and +/- scale it, so it has to be reachable by keyboard.
			tabIndex={0}
		>
			<desc id={hintId}>
				{t(
					'workbench:architecture-diagram.canvas.hint',
					'Drag or press the arrow keys to pan. Pinch, hold Command and scroll, or press plus and minus to zoom. Press 0 to fit the whole diagram. Press N and P to step between modules, Enter to see what one connects to, and Escape to clear that again.',
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
				{frames}
				{edges}
				{nodes}
			</g>
		</svg>
	);
}
