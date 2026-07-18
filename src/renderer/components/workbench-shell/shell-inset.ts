/**
 * Tailwind classes for a full-viewport `SidebarInset`: fills the height beside
 * the sidebar and clips overflow so descendant panels own their own scrolling.
 * Shared by every top-level shell screen (welcome, dashboard, empty state,
 * workspace layout) so the base chrome stays identical across them.
 */
export const SHELL_INSET_CLASS =
	'flex h-svh min-h-svh overflow-hidden bg-background text-foreground';

/**
 * Tailwind classes for the collapsed-sidebar expand trigger when a shell screen
 * has no toolbar to anchor it inline. Floats it in the top-left safe area beside
 * the traffic-light controls; the `sidebar-collapsed-trigger` rule keeps it
 * hidden until the sidebar is collapsed.
 */
export const SHELL_FLOATING_TRIGGER_CLASS =
	'sidebar-collapsed-trigger absolute top-2.5 left-[var(--ensemblr-traffic-light-safe-inline)] z-20';
