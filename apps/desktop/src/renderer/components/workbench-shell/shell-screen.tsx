import type { ReactNode } from 'react';

import { SidebarInset } from '@/renderer/components/ui/sidebar';
import { cn } from '@/renderer/lib/utils';
import { SHELL_INSET_CLASS } from '@/renderer/lib/workbench/shell-inset';

/** The content column's default shape: a full-height flex column that clips. */
const SHELL_CONTENT_CLASS = 'flex min-w-0 flex-1 flex-col overflow-hidden';

/**
 * The chrome every top-level shell screen sits in: the `SidebarInset` bounded to
 * the viewport, plus the column its toolbar and body stack inside.
 *
 * Screens compose this rather than `SidebarInset` directly because two
 * invariants ride on the element it renders. The collapsed-sidebar expand
 * trigger stays `display: none` until it sits inside a
 * `[data-slot="sidebar-inset"]` that is a sibling of the sidebar, and the inset
 * is already the page's `<main>` landmark — so content nests in a `div` rather
 * than a second, hierarchically invalid `<main>`.
 *
 * `className` replaces the content column's layout for screens that centre their
 * body instead of stacking it.
 */
export function ShellScreen({
	children,
	className,
}: {
	children: ReactNode;
	className?: string;
}) {
	return (
		<SidebarInset className={SHELL_INSET_CLASS}>
			<div className={cn(SHELL_CONTENT_CLASS, className)}>{children}</div>
		</SidebarInset>
	);
}
