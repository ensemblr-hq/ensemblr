import { Undo2Icon } from 'lucide-react';
import type { ReactNode } from 'react';

import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from '@/renderer/components/ui/tooltip';
import { cn } from '@/renderer/lib/utils';

/** Props for a settings section row. */
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
	/**
	 * Restores this setting to its default value. When provided together with
	 * `modified`, a revert control appears next to the label on hover/focus.
	 */
	onReset?: () => void;
	/** Extra content rendered below the description (full-width). */
	children?: ReactNode;
	className?: string;
}

/** Icon button that reverts a modified setting to its default; revealed on row hover or keyboard focus. */
function RevertToDefaultButton({ onReset }: { onReset: () => void }) {
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<button
					aria-label='Revert to default'
					className='inline-flex size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring group-hover:opacity-100'
					onClick={onReset}
					type='button'
				>
					<Undo2Icon aria-hidden='true' className='size-3.5' />
				</button>
			</TooltipTrigger>
			<TooltipContent>Revert to default</TooltipContent>
		</Tooltip>
	);
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
	onReset,
	stack = false,
}: SettingRowProps) {
	const LabelTag = htmlFor ? 'label' : 'div';
	const showReset = modified && Boolean(onReset);

	return (
		<div className={cn('group relative flex flex-col gap-3 py-4', className)}>
			{modified ? (
				<span
					aria-hidden='true'
					className='absolute top-4 bottom-4 -left-4 w-0.5 rounded-full bg-accent-strong'
				/>
			) : null}
			<div
				className={cn(
					'flex flex-col gap-3',
					stack
						? 'items-stretch'
						: 'sm:flex-row sm:items-start sm:justify-between sm:gap-6',
				)}
			>
				<div className='min-w-0 flex-1 space-y-1'>
					<div className='flex items-center gap-1.5'>
						<LabelTag
							className='font-medium text-foreground text-sm'
							htmlFor={htmlFor}
						>
							{label}
						</LabelTag>
						{showReset && onReset ? (
							<RevertToDefaultButton onReset={onReset} />
						) : null}
					</div>
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
			</div>
			{children ? <div className='w-full'>{children}</div> : null}
		</div>
	);
}
