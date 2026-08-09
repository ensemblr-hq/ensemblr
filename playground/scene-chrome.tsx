import type { ReactNode } from 'react';
import { createContext, use } from 'react';
import { createPortal } from 'react-dom';

import { cn } from '@/renderer/lib/utils';

const SceneControlHostContext = createContext<HTMLElement | null>(null);

/**
 * Publishes the right-sidebar node that scene controls render into. The shell
 * owns the node; scenes stay unaware of where their toggles land.
 */
export function SceneControlHostProvider({
	children,
	host,
}: {
	children: ReactNode;
	host: HTMLElement | null;
}) {
	return (
		<SceneControlHostContext.Provider value={host}>
			{children}
		</SceneControlHostContext.Provider>
	);
}

/**
 * Renders a scene's own toggles in the right sidebar while their state stays
 * with the scene that owns it. Portalling rather than lifting the state into the
 * shell keeps each scene's permutations local — the shell would otherwise need a
 * union of every scene's control model. Renders nothing while the sidebar is
 * collapsed.
 */
export function SceneControls({ children }: { children: ReactNode }) {
	const host = use(SceneControlHostContext);

	return host ? createPortal(children, host) : null;
}

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

/**
 * One labelled cluster of toggles. Stacked rather than inline because these live
 * in a sidebar column, where a row of label-then-pills runs out of width after
 * two options.
 */
export function ControlGroup({
	children,
	label,
}: {
	children: ReactNode;
	label: string;
}) {
	return (
		<div className='flex flex-col gap-1'>
			<span className='font-mono text-muted-foreground text-xxs uppercase tracking-wide'>
				{label}
			</span>
			<div className='flex flex-wrap items-center gap-1'>{children}</div>
		</div>
	);
}

/**
 * Playground toggle pill, used by both the shell's canvas settings and the
 * scenes' own controls. Deliberately not a shipped `Button` — the playground's
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
