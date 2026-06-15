import type { ReactNode } from 'react';

import { cn } from '@/renderer/lib/utils';

interface SettingRowProps {
	/** Primary row label, shown bold. */
	label: ReactNode;
	/** Secondary explanation text shown under the label. */
	description?: ReactNode;
	/** Control(s) rendered on the trailing edge of the row. */
	control?: ReactNode;
	/** Optional id of an input the label points at — improves screen-reader behavior. */
	htmlFor?: string;
	/** When true, stack the control beneath the label/description instead of trailing it. */
	stack?: boolean;
	/** When true, mark the row with a left accent bar (value differs from default). */
	modified?: boolean;
	/** Extra content rendered below the description (full-width). */
	children?: ReactNode;
	className?: string;
}

/** One row inside a settings section: label + description on the left, control on the right. */
export function SettingRow({
	children,
	className,
	control,
	description,
	htmlFor,
	label,
	modified = false,
	stack = false,
}: SettingRowProps) {
	const LabelTag = htmlFor ? 'label' : 'div';

	return (
		<div
			className={cn(
				'relative flex flex-col gap-3 py-4',
				stack
					? 'items-stretch'
					: 'sm:flex-row sm:items-start sm:justify-between sm:gap-6',
				className,
			)}
		>
			{modified ? (
				<span
					aria-hidden='true'
					className='absolute top-4 bottom-4 -left-4 w-0.5 rounded-full bg-accent-strong'
				/>
			) : null}
			<div className='min-w-0 flex-1 space-y-1'>
				<LabelTag
					className='block font-medium text-foreground text-sm'
					htmlFor={htmlFor}
				>
					{label}
				</LabelTag>
				{description ? (
					<p className='text-muted-foreground text-xs leading-relaxed'>
						{description}
					</p>
				) : null}
			</div>
			{control ? (
				<div
					className={cn(
						'flex shrink-0 items-center gap-2',
						stack ? 'self-stretch' : 'sm:justify-end',
					)}
				>
					{control}
				</div>
			) : null}
			{children ? <div className='w-full'>{children}</div> : null}
		</div>
	);
}
