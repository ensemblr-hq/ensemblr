import {
	PanelLeftCloseIcon,
	PanelLeftOpenIcon,
	PanelRightCloseIcon,
	PanelRightOpenIcon,
} from 'lucide-react';
import type { ComponentType, ReactNode } from 'react';
import { useCallback, useState } from 'react';

import { cn } from '@/renderer/lib/utils';

/** Namespaces the remembered collapse state so it cannot collide with app keys. */
const OPEN_STATE_STORAGE_PREFIX = 'playground:sidebar:';

/** Which edge a sidebar is docked to, which decides its chrome and icons. */
type SidebarSide = 'left' | 'right';

/**
 * Open state for one sidebar, remembered across reloads so a layout you set up
 * for a component survives the dev server restarting under it.
 * @param key - Stable id for this sidebar within the playground.
 * @param initiallyOpen - State to use before anything has been remembered.
 * @returns The current state and a toggle that persists the new one.
 */
export function useSidebarToggle(
	key: string,
	initiallyOpen: boolean,
): { isOpen: boolean; toggle: () => void } {
	const [isOpen, setOpen] = useState(() =>
		readStoredOpenState(key, initiallyOpen),
	);

	const toggle = useCallback(() => {
		const next = !isOpen;
		setOpen(next);
		window.localStorage.setItem(
			`${OPEN_STATE_STORAGE_PREFIX}${key}`,
			next ? 'open' : 'collapsed',
		);
	}, [isOpen, key]);

	return { isOpen, toggle };
}

/**
 * A collapsible playground sidebar. Collapsed it keeps a labelled rail rather
 * than disappearing, so the canvas never sits between two unexplained edges.
 */
export function PlaygroundSidebar({
	children,
	isOpen,
	label,
	onToggle,
	side,
}: {
	children: ReactNode;
	isOpen: boolean;
	label: string;
	onToggle: () => void;
	side: SidebarSide;
}) {
	const edge = side === 'left' ? 'border-r' : 'border-l';

	if (!isOpen) {
		return (
			<div
				className={cn(
					'flex w-9 shrink-0 flex-col items-center gap-3 border-border bg-toolbar py-2',
					edge,
				)}
			>
				<SidebarToggle
					isOpen={false}
					label={label}
					onClick={onToggle}
					side={side}
				/>
				<span className='font-mono text-muted-foreground text-xxs uppercase tracking-widest [writing-mode:vertical-rl]'>
					{label}
				</span>
			</div>
		);
	}

	return (
		<aside
			className={cn(
				'flex shrink-0 flex-col border-border bg-toolbar',
				side === 'left' ? 'w-44' : 'w-60',
				edge,
			)}
		>
			<header className='flex h-9 shrink-0 items-center gap-1 border-border border-b px-2'>
				<span className='font-mono text-muted-foreground text-xxs uppercase tracking-wide'>
					{label}
				</span>
				<SidebarToggle
					className={side === 'left' ? 'order-last ml-auto' : 'order-first'}
					isOpen
					label={label}
					onClick={onToggle}
					side={side}
				/>
			</header>
			<div className='flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-2'>
				{children}
			</div>
		</aside>
	);
}

/** The collapse/expand affordance, pointing the way the panel will move. */
function SidebarToggle({
	className,
	isOpen,
	label,
	onClick,
	side,
}: {
	className?: string;
	isOpen: boolean;
	label: string;
	onClick: () => void;
	side: SidebarSide;
}) {
	const Icon = pickToggleIcon(side, isOpen);

	return (
		<button
			aria-label={`${isOpen ? 'Collapse' : 'Expand'} ${label} sidebar`}
			className={cn(
				'flex size-5 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground',
				className,
			)}
			onClick={onClick}
			type='button'
		>
			<Icon className='size-3.5' />
		</button>
	);
}

/**
 * Picks the panel icon whose closing edge matches the sidebar being toggled.
 * @param side - Edge the sidebar is docked to.
 * @param isOpen - Whether the sidebar is currently expanded.
 * @returns The lucide icon component for the toggle.
 */
function pickToggleIcon(
	side: SidebarSide,
	isOpen: boolean,
): ComponentType<{ className?: string }> {
	if (side === 'left') {
		return isOpen ? PanelLeftCloseIcon : PanelLeftOpenIcon;
	}
	return isOpen ? PanelRightCloseIcon : PanelRightOpenIcon;
}

/**
 * Reads the remembered open state, treating anything unrecognised as "never set"
 * so a stale or hand-edited value falls back instead of pinning a sidebar shut.
 * @param key - Stable id for the sidebar.
 * @param fallback - State to use when nothing usable is stored.
 * @returns Whether the sidebar should start open.
 */
function readStoredOpenState(key: string, fallback: boolean): boolean {
	const stored = window.localStorage.getItem(
		`${OPEN_STATE_STORAGE_PREFIX}${key}`,
	);
	if (stored === 'open') {
		return true;
	}
	if (stored === 'collapsed') {
		return false;
	}
	return fallback;
}
