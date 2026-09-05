import { FileIcon, FolderOpenIcon } from 'lucide-react';
import { memo, type ReactNode } from 'react';
import type { DiagramNode as PositionedNode } from '@/renderer/lib/architecture-diagram';
import { fittedNodeFontSize } from '@/renderer/lib/architecture-diagram';
import { cn } from '@/renderer/lib/utils';
import type { ArchitectureDeltaStatus } from '@/shared/architecture-diagram';

import { COMPONENT_TONE, DELTA_TONE, NODE_TEXT_SIZES } from './diagram-tokens';
import { namesAFile } from './source-path';

/** Geometry of the corner control that opens a node's source. */
const OPEN_BUTTON = { icon: 11, inset: 5, size: 18 } as const;

/** Focus ring an SVG group can actually show — `ring` is a box-shadow, which it cannot. */
const SVG_FOCUS_RING =
	'outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring focus-visible:-outline-offset-2';

/** Everything one module box is drawn and driven from. */
interface DiagramNodeProps {
	deltaStatus: ArchitectureDeltaStatus | null;
	/** True while this node is the diagram's single node-group tab stop. */
	isActive: boolean;
	/** True while another node's selection has pushed this one into the background. */
	isDimmed: boolean;
	isSelected: boolean;
	node: PositionedNode;
	onOpenSource: ((path: string) => void) | null;
	onSelect: (nodeId: string | null) => void;
	/** Pre-translated label for the corner control, null when there is no source. */
	openSourceLabel: string | null;
	/** Pre-translated accessible name for the body. */
	selectLabel: string;
}

/**
 * One module box.
 *
 * The body selects rather than navigates: a diagram of fifty boxes is unusable
 * until you can ask one of them what it talks to, and a click that left the
 * diagram made that the one thing it could not do. Going to the files is still
 * one click, but a deliberate one, on the corner control.
 *
 * Memoized, and handed labels rather than translating its own: a pan writes new
 * viewport state on every pointer event, and a two-hundred-node diagram cannot
 * afford to reconcile — let alone re-interpolate — itself per frame.
 */
export const DiagramNode = memo(function DiagramNode({
	deltaStatus,
	isActive,
	isDimmed,
	isSelected,
	node,
	onOpenSource,
	onSelect,
	openSourceLabel,
	selectLabel,
}: DiagramNodeProps) {
	const sourcePath = node.component.sources?.[0]?.path ?? null;

	return (
		<g
			className={cn(
				'transition-opacity duration-150',
				isDimmed && 'opacity-15',
			)}
			data-delta={deltaStatus ?? undefined}
			data-dimmed={isDimmed ? 'true' : undefined}
			data-node-id={node.id}
		>
			{/* biome-ignore lint/a11y/useSemanticElements: SVG has no <button>; role="button" plus tabIndex on a <g> is the accessible pattern for a clickable shape, and a foreignObject wrapper would break the diagram's own coordinate space. */}
			<g
				aria-label={selectLabel}
				aria-pressed={isSelected}
				className={cn('cursor-pointer', SVG_FOCUS_RING)}
				onClick={() => onSelect(isSelected ? null : node.id)}
				onKeyDown={(event) => {
					if (event.key === 'Enter' || event.key === ' ') {
						event.preventDefault();
						onSelect(isSelected ? null : node.id);
					}
				}}
				role='button'
				tabIndex={isActive ? 0 : -1}
			>
				<NodeBody
					deltaStatus={deltaStatus}
					isSelected={isSelected}
					node={node}
				/>
			</g>
			{sourcePath && openSourceLabel && onOpenSource ? (
				<OpenSourceButton
					isActive={isActive}
					label={openSourceLabel}
					node={node}
					onOpen={() => onOpenSource(sourcePath)}
					sourcePath={sourcePath}
				/>
			) : null}
		</g>
	);
});

/**
 * The corner control that opens the node's source — a file in the preview, a
 * directory revealed in All files. Carried as its own hit target so selecting a
 * node and leaving the diagram stay separate intentions.
 */
function OpenSourceButton({
	isActive,
	label,
	node,
	onOpen,
	sourcePath,
}: {
	isActive: boolean;
	label: string;
	node: PositionedNode;
	onOpen: () => void;
	sourcePath: string;
}) {
	const x = node.x + node.width - OPEN_BUTTON.size - OPEN_BUTTON.inset;
	const y = node.y + OPEN_BUTTON.inset;
	const Icon = namesAFile(sourcePath) ? FileIcon : FolderOpenIcon;

	/** Opens the source without also selecting the node the control sits on. */
	function open(event: {
		preventDefault: () => void;
		stopPropagation: () => void;
	}) {
		event.preventDefault();
		event.stopPropagation();
		onOpen();
	}

	return (
		// biome-ignore lint/a11y/useSemanticElements: same SVG constraint as the node body — there is no <button> element inside an <svg> coordinate space.
		<g
			aria-label={label}
			className={cn(
				'cursor-pointer opacity-45 transition-opacity hover:opacity-100 focus-visible:opacity-100',
				SVG_FOCUS_RING,
			)}
			onClick={open}
			onKeyDown={(event) => {
				if (event.key === 'Enter' || event.key === ' ') {
					open(event);
				}
			}}
			role='button'
			tabIndex={isActive ? 0 : -1}
		>
			<title>{label}</title>
			<rect
				className='fill-background/80 stroke-border'
				height={OPEN_BUTTON.size}
				rx={5}
				strokeWidth={1}
				width={OPEN_BUTTON.size}
				x={x}
				y={y}
			/>
			<Icon
				aria-hidden='true'
				className='text-muted-foreground'
				height={OPEN_BUTTON.icon}
				width={OPEN_BUTTON.icon}
				x={x + (OPEN_BUTTON.size - OPEN_BUTTON.icon) / 2}
				y={y + (OPEN_BUTTON.size - OPEN_BUTTON.icon) / 2}
			/>
		</g>
	);
}

/**
 * The box, its delta ring, its selection ring, and its two lines of text. Split
 * from the wrapper so the shape stays one drawing while the wrapper carries the
 * role and the handlers.
 */
function NodeBody({
	deltaStatus,
	isSelected,
	node,
}: {
	deltaStatus: ArchitectureDeltaStatus | null;
	isSelected: boolean;
	node: PositionedNode;
}): ReactNode {
	const tone = COMPONENT_TONE[node.component.type];
	const labelSize = fittedNodeFontSize(
		node.component.label,
		node.width,
		NODE_TEXT_SIZES.labelPreferred,
		NODE_TEXT_SIZES.labelMinimum,
	);
	const sublabelSize = fittedNodeFontSize(
		node.component.sublabel,
		node.width,
		NODE_TEXT_SIZES.sublabelPreferred,
		NODE_TEXT_SIZES.sublabelMinimum,
	);
	return (
		<>
			{/* An opaque base under the tint. The role fills are 10% alpha, which
			    let every edge routed behind a box show straight through it — the
			    paint order says "edges pass behind nodes" and this is what makes
			    that true on screen. */}
			<rect
				className='fill-background'
				height={node.height}
				rx={8}
				width={node.width}
				x={node.x}
				y={node.y}
			/>
			<rect
				className={cn(tone.fill, tone.stroke, isSelected && 'fill-accent/40')}
				height={node.height}
				rx={8}
				strokeWidth={isSelected ? 2 : 1}
				width={node.width}
				x={node.x}
				y={node.y}
			/>
			{isSelected ? (
				<rect
					className='fill-none stroke-ring'
					height={node.height + 8}
					rx={12}
					strokeWidth={2}
					width={node.width + 8}
					x={node.x - 4}
					y={node.y - 4}
				/>
			) : null}
			{deltaStatus ? (
				<rect
					className={cn('fill-none', DELTA_TONE[deltaStatus])}
					height={node.height + 6}
					rx={11}
					strokeWidth={1.5}
					width={node.width + 6}
					x={node.x - 3}
					y={node.y - 3}
				/>
			) : null}
			<text
				className={cn('font-medium', tone.text)}
				fontSize={labelSize}
				textAnchor='middle'
				x={node.cx}
				y={node.component.sublabel ? node.cy : node.cy + labelSize / 3}
			>
				{node.component.label}
			</text>
			{node.component.sublabel ? (
				<text
					className='fill-muted-foreground'
					fontSize={sublabelSize}
					textAnchor='middle'
					x={node.cx}
					y={node.cy + sublabelSize + 4}
				>
					{node.component.sublabel}
				</text>
			) : null}
		</>
	);
}
