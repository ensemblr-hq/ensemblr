import { Icon } from '@iconify/react';
import { ChevronDownIcon, ChevronRightIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/renderer/components/ui/button';
import { cn } from '@/renderer/lib/utils';
import {
	fileTreeIndentClassName,
	getWorkspaceFileIconName,
} from '@/renderer/lib/workbench';

import { FileTreeLabel } from './file-tree-label';

/**
 * Folder row of the changes tree, with collapse chevron and label. Memoized on
 * the label's contents because the row model allocates a fresh `labelParts`
 * array on every flatten.
 */
export const ReviewFolderRow = memo(
	function ReviewFolderRow({
		ariaPosInSet,
		ariaSetSize,
		isExpanded,
		labelParts,
		level,
		onToggle,
		path,
	}: {
		/** 1-based position among the parent's entries. */
		ariaPosInSet: number;
		/** Number of entries under the same parent. */
		ariaSetSize: number;
		isExpanded: boolean;
		labelParts: string[];
		level: number;
		onToggle: (path: string) => void;
		path: string;
	}) {
		const { t } = useTranslation();
		const isCollapsed = !isExpanded;
		const FolderChevronIcon = isCollapsed ? ChevronRightIcon : ChevronDownIcon;
		// A collapsed row only advertises its own name; the merged `a / b / c` chain
		// is shown once expanded, when its single-child descendants are revealed.
		const visibleLabelParts = isCollapsed ? labelParts.slice(0, 1) : labelParts;
		const folderIconName = getWorkspaceFileIconName(
			{ kind: 'directory', name: visibleLabelParts.at(-1) ?? path },
			{ isExpanded },
		);

		return (
			<Button
				aria-expanded={isExpanded}
				aria-label={
					isCollapsed
						? t('workbench:file-tree.expand-folder', 'Expand {{path}}', {
								path,
							})
						: t('workbench:file-tree.collapse-folder', 'Collapse {{path}}', {
								path,
							})
				}
				aria-level={level + 1}
				aria-posinset={ariaPosInSet}
				aria-setsize={ariaSetSize}
				// Highlight only on hover: drop the ghost variant's persistent
				// open-state fill (`aria-expanded:bg-muted`) while keeping the hover
				// fill for expanded folders.
				className={cn(
					'h-7 w-full justify-start gap-1.5 rounded-md px-2 text-xs aria-expanded:bg-transparent aria-expanded:hover:bg-muted',
					fileTreeIndentClassName(level),
				)}
				onClick={() => onToggle(path)}
				role='treeitem'
				size='sm'
				variant='ghost'
			>
				<FolderChevronIcon aria-hidden='true' className='size-3 shrink-0' />
				<Icon
					aria-hidden='true'
					className='size-3.5 shrink-0'
					icon={folderIconName}
				/>
				<FileTreeLabel parts={visibleLabelParts} />
			</Button>
		);
	},
	// Every prop is listed: a prop added to this component must be added here
	// too, or memo silently skips renders on stale props.
	(previous, next) =>
		previous.ariaPosInSet === next.ariaPosInSet &&
		previous.ariaSetSize === next.ariaSetSize &&
		previous.isExpanded === next.isExpanded &&
		previous.level === next.level &&
		previous.path === next.path &&
		previous.onToggle === next.onToggle &&
		previous.labelParts.length === next.labelParts.length &&
		previous.labelParts.every((part, index) => part === next.labelParts[index]),
);
