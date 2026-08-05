import type { ReactNode } from 'react';

import { cn } from '@/renderer/lib/utils';

/** A titled block within a scene, introducing what the surface below it shows. */
export function SceneSection({
	children,
	label,
	note,
}: {
	children: ReactNode;
	label: string;
	note: string;
}) {
	return (
		<section className='flex flex-col gap-4'>
			<div className='flex flex-col gap-0.5 border-border border-b pb-1.5'>
				<h2 className='font-semibold text-sm'>{label}</h2>
				<p className='text-muted-foreground text-xxs'>{note}</p>
			</div>
			{children}
		</section>
	);
}

/** One labelled cluster of scene toggles. */
export function ControlGroup({
	children,
	label,
}: {
	children: ReactNode;
	label: string;
}) {
	return (
		<div className='flex items-center gap-1.5'>
			<span className='font-mono text-muted-foreground text-xxs uppercase tracking-wide'>
				{label}
			</span>
			<div className='flex items-center gap-1'>{children}</div>
		</div>
	);
}

/**
 * Scene-local toggle pill. Deliberately not a shipped `Button` — the scene's own
 * chrome must not be mistaken for, or measured as, the surface under review.
 */
export function SceneToggle({
	isActive,
	label,
	onClick,
}: {
	isActive: boolean;
	label: string;
	onClick: () => void;
}) {
	return (
		<button
			className={cn(
				'rounded-md border px-2 py-0.5 font-mono text-xxs transition-colors',
				isActive
					? 'border-border bg-background text-foreground'
					: 'border-transparent text-muted-foreground hover:bg-accent/50',
			)}
			onClick={onClick}
			type='button'
		>
			{label}
		</button>
	);
}
