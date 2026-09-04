import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { DiagramNode as PositionedNode } from '@/renderer/lib/architecture-diagram';
import { fittedNodeFontSize } from '@/renderer/lib/architecture-diagram';
import { cn } from '@/renderer/lib/utils';
import type { ArchitectureDeltaStatus } from '@/shared/architecture-diagram';

import { COMPONENT_TONE, DELTA_TONE, NODE_TEXT_SIZES } from './diagram-tokens';

/**
 * One module box. A node that names a source opens it in the file preview,
 * which is the diagram's whole reason to be interactive: the point of seeing
 * the shape is being able to go there.
 */
export function DiagramNode({
	deltaStatus,
	node,
	onOpenSource,
}: {
	deltaStatus: ArchitectureDeltaStatus | null;
	node: PositionedNode;
	onOpenSource: ((path: string) => void) | null;
}) {
	const { t } = useTranslation();
	const sourcePath = node.component.sources?.[0]?.path ?? null;
	const accessibleName = node.component.sublabel
		? `${node.component.label} — ${node.component.sublabel}`
		: node.component.label;
	const body = <NodeBody deltaStatus={deltaStatus} node={node} />;

	if (!sourcePath || !onOpenSource) {
		return (
			// biome-ignore lint/a11y/noInteractiveElementToNoninteractiveRole: the rule reads <g> as HTML; in SVG it is a grouping element and role="img" with a <title> is how a shape gets an accessible name.
			<g aria-label={accessibleName} role='img'>
				<title>{accessibleName}</title>
				{body}
			</g>
		);
	}
	return (
		// biome-ignore lint/a11y/useSemanticElements: SVG has no <button>; role="button" plus tabIndex on a <g> is the accessible pattern for a clickable shape, and a foreignObject wrapper would break the diagram's own coordinate space.
		<g
			aria-label={accessibleName}
			className='cursor-pointer'
			onClick={() => onOpenSource(sourcePath)}
			onKeyDown={(event) => {
				if (event.key === 'Enter' || event.key === ' ') {
					event.preventDefault();
					onOpenSource(sourcePath);
				}
			}}
			role='button'
			tabIndex={0}
		>
			<title>
				{t(
					'workbench:architecture-diagram.node.open-title',
					'{{name}} — open {{path}}',
					{ name: accessibleName, path: sourcePath },
				)}
			</title>
			{body}
		</g>
	);
}

/**
 * The box, its delta ring, and its two lines of text. Split from the wrapper so
 * the openable and static variants share one drawing and differ only in the
 * role and handlers they carry.
 */
function NodeBody({
	deltaStatus,
	node,
}: {
	deltaStatus: ArchitectureDeltaStatus | null;
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
			<rect
				className={cn(tone.fill, tone.stroke)}
				height={node.height}
				rx={8}
				strokeWidth={1}
				width={node.width}
				x={node.x}
				y={node.y}
			/>
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
