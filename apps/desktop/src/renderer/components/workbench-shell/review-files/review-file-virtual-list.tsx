import { useVirtualizer } from '@tanstack/react-virtual';
import { type MouseEvent, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import {
	type ReviewGroupId,
	type ReviewListRow,
	reviewRowSize,
} from '@/renderer/lib/workbench/review-file-rows';

import { ReviewFileRow } from './review-file-row';
import { ReviewFolderRow } from './review-folder-row';

/** Extra rows rendered above/below the viewport to keep scrolling smooth. */
const ROW_OVERSCAN = 12;

/**
 * Assumed viewport height before the scroll element is measured, so the first
 * render (and static markup in tests) emits rows instead of an empty pane.
 */
const INITIAL_VIEWPORT_HEIGHT = 1200;

/**
 * Renders the Changes rows through a virtualizer so only the rows near the
 * viewport mount. Rows have fixed sizes and stable keys, which lets a row that
 * moves (a viewed file sinking) keep its DOM node.
 */
export function ReviewFileVirtualList({
	isTree,
	onContextMenuCapture,
	onToggleDirectory,
	rows,
}: {
	/** True in folders mode, where the rows form an ARIA tree. */
	isTree: boolean;
	onContextMenuCapture: (event: MouseEvent<HTMLDivElement>) => void;
	onToggleDirectory: (path: string) => void;
	rows: readonly ReviewListRow[];
}) {
	const scrollRef = useRef<HTMLDivElement>(null);
	const virtualizer = useVirtualizer({
		count: rows.length,
		estimateSize: (index) => reviewRowSize(rows[index]),
		getItemKey: (index) => rows[index].key,
		getScrollElement: () => scrollRef.current,
		initialRect: { height: INITIAL_VIEWPORT_HEIGHT, width: 0 },
		overscan: ROW_OVERSCAN,
	});

	return (
		<div
			className='sleek-scrollbar h-full overflow-y-auto p-3'
			onContextMenuCapture={onContextMenuCapture}
			ref={scrollRef}
		>
			<div
				className='relative w-full'
				role={isTree ? 'tree' : undefined}
				style={{ height: `${virtualizer.getTotalSize()}px` }}
			>
				{virtualizer.getVirtualItems().map((virtualRow) => (
					<div
						className='absolute top-0 left-0 w-full'
						key={virtualRow.key}
						role={isTree ? 'none' : undefined}
						style={{
							height: `${virtualRow.size}px`,
							transform: `translateY(${virtualRow.start}px)`,
						}}
					>
						<ReviewListRowView
							onToggleDirectory={onToggleDirectory}
							row={rows[virtualRow.index]}
						/>
					</div>
				))}
			</div>
		</div>
	);
}

/** Dispatches one row of the model to the component that draws it. */
function ReviewListRowView({
	onToggleDirectory,
	row,
}: {
	onToggleDirectory: (path: string) => void;
	row: ReviewListRow;
}) {
	switch (row.type) {
		case 'group':
			return <ReviewGroupHeader group={row.group} />;
		case 'directory':
			return (
				<ReviewFolderRow
					ariaPosInSet={row.ariaPosInSet}
					ariaSetSize={row.ariaSetSize}
					isExpanded={row.isExpanded}
					labelParts={row.labelParts}
					level={row.level}
					onToggle={onToggleDirectory}
					path={row.path}
				/>
			);
		case 'file':
			return (
				<ReviewFileRow
					ariaLevel={row.ariaLevel}
					ariaPosInSet={row.ariaPosInSet}
					ariaSetSize={row.ariaSetSize}
					file={row.file}
					level={row.level}
					showPath={row.showPath}
				/>
			);
	}
}

/** Label of one band of the flat list, shown when conflicts split it in two. */
function ReviewGroupHeader({ group }: { group: ReviewGroupId }) {
	const { t } = useTranslation();

	return (
		<h3 className='px-2 pt-1 font-semibold text-muted-foreground text-xs'>
			{group === 'conflicts'
				? t('review:changes.group-conflicts', 'Conflicts')
				: t('review:changes.group-clean', 'Clean')}
		</h3>
	);
}
