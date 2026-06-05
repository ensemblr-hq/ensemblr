'use client';

import { Grip } from 'lucide-react';
import { Reorder, useDragControls, useMotionValue } from 'motion/react';
import React, { useEffect, useMemo, useState } from 'react';

import { useRaisedShadow } from '@/hooks/ui/useRaisedShadow';
import { cn } from '@/lib/utils';

const ReorderList: React.FC<ReorderListProps> = ({
	className,
	disableLayoutAnimation = false,
	itemClassName,
	usePositionOnlyLayoutAnimation = false,
	withDragHandle = false,
	onReorderFinish,
	...props
}) => {
	const children = useMemo(
		() =>
			React.Children.toArray(props.children).filter((child) =>
				React.isValidElement(child),
			) as React.ReactElement[],
		[props.children],
	);
	const childEntries = useMemo(
		() =>
			children.map((child, index) => ({
				element: child,
				key: getReorderElementKey(child.key, index),
			})),
		[children],
	);
	const childKeys = useMemo(
		() => childEntries.map((entry) => entry.key),
		[childEntries],
	);
	const childrenByKey = useMemo(
		() =>
			new Map(childEntries.map((entry) => [entry.key, entry.element] as const)),
		[childEntries],
	);
	const [orderedKeys, setOrderedKeys] = useState<string[]>(childKeys);

	useEffect(() => {
		setOrderedKeys((currentKeys) => {
			const childKeySet = new Set(childKeys);
			const nextKeys = [
				...currentKeys.filter((key) => childKeySet.has(key)),
				...childKeys.filter((key) => !currentKeys.includes(key)),
			];

			return areStringArraysEqual(nextKeys, currentKeys)
				? currentKeys
				: nextKeys;
		});
	}, [childKeys]);

	const handleReorderFinish = (newOrder: unknown[]) => {
		const nextKeys = newOrder as string[];
		setOrderedKeys(nextKeys);
		onReorderFinish?.(
			nextKeys
				.map((key) => childrenByKey.get(key))
				.filter((child): child is React.ReactElement => Boolean(child)),
		);
	};

	return (
		<Reorder.Group
			data-slot='reorder-list-group'
			axis='y'
			className={cn(
				'!p-0 !m-0 flex select-none list-none flex-col gap-1',
				className,
			)}
			values={orderedKeys}
			onReorder={handleReorderFinish}
			{...props}
		>
			{orderedKeys.map((key) => {
				const item = childrenByKey.get(key);

				if (!item) {
					return null;
				}

				return (
					<ReorderListItem
						key={key}
						disableLayoutAnimation={disableLayoutAnimation}
						item={item}
						itemKey={key}
						usePositionOnlyLayoutAnimation={usePositionOnlyLayoutAnimation}
						withDragHandle={withDragHandle}
						className={itemClassName}
					/>
				);
			})}
		</Reorder.Group>
	);
};

function getReorderElementKey(
	key: React.ReactElement['key'],
	index: number,
): string {
	if (key == null) {
		return `index-${index}`;
	}

	return String(key).replace(/^\.\$/, '').replace(/^\./, '');
}

function areStringArraysEqual(first: string[], second: string[]) {
	return (
		first.length === second.length &&
		first.every((value, index) => value === second[index])
	);
}

const ReorderListItem: React.FC<{
	disableLayoutAnimation?: boolean;
	item: React.ReactElement;
	itemKey: string;
	className?: string;
	usePositionOnlyLayoutAnimation?: boolean;
	withDragHandle?: boolean;
}> = ({
	disableLayoutAnimation = false,
	item,
	itemKey,
	className,
	usePositionOnlyLayoutAnimation = false,
	withDragHandle = false,
}) => {
	const y = useMotionValue(0);
	const boxShadow = useRaisedShadow(y);
	const dragControls = useDragControls();

	return (
		<Reorder.Item
			data-slot='reorder-list-item'
			id={itemKey}
			value={itemKey}
			layout={usePositionOnlyLayoutAnimation ? 'position' : undefined}
			transition={
				disableLayoutAnimation ? { layout: { duration: 0 } } : undefined
			}
			className={cn(
				'!p-0 !m-0 list-none bg-background',
				!withDragHandle ? 'cursor-grab' : '',
				className,
			)}
			style={{ boxShadow, y }}
			dragListener={!withDragHandle}
			dragControls={withDragHandle ? dragControls : undefined}
		>
			{withDragHandle ? (
				<div className='relative flex items-center gap-2'>
					{React.isValidElement<{ className?: string }>(item)
						? React.cloneElement(item, {
								className: cn('w-full pr-12', item.props.className),
							})
						: item}
					<Grip
						className='absolute top-1/2 right-4 size-6 -translate-y-1/2 cursor-grab text-muted-foreground'
						onPointerDown={(e) => dragControls.start(e)}
					/>
				</div>
			) : (
				item
			)}
		</Reorder.Item>
	);
};

export interface ReorderListProps
	extends Partial<React.ComponentProps<typeof Reorder.Group>> {
	/** @public (required) - The children of the list */
	children: React.ReactElement[];
	/** @public (optional) - The className of the list */
	className?: string;
	/** @public (optional) - The className of the item */
	itemClassName?: string;
	/** @public (optional) - Disable item layout animation */
	disableLayoutAnimation?: boolean;
	/** @public (optional) - Only animate item position layout changes */
	usePositionOnlyLayoutAnimation?: boolean;
	/** @public (optional) - With drag handle */
	withDragHandle?: boolean;
	/** @public (optional) - When the list is reordered */
	onReorderFinish?: (newOrder: React.ReactElement[]) => void;
}

export { ReorderList };
