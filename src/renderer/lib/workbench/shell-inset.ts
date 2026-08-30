/**
 * Tailwind classes for a full-window `SidebarInset`: fills the height beside
 * the sidebar — the viewport less whatever title bar Ensemblr draws above it —
 * and clips overflow so descendant panels own their own scrolling. Shared by
 * every top-level shell screen (welcome, dashboard, empty state, workspace
 * layout) so the base chrome stays identical across them.
 */
export const SHELL_INSET_CLASS =
	'flex h-(--ensemblr-shell-height) min-h-(--ensemblr-shell-height) overflow-hidden bg-background text-foreground';

/**
 * Tailwind classes for the collapsed-sidebar expand trigger when a shell screen
 * has no toolbar to anchor it inline. Floats it in the top-left safe area beside
 * whatever the window's leading chrome claims — the macOS traffic lights, or
 * nothing at all; the `sidebar-collapsed-trigger` rule keeps it hidden until the
 * sidebar is collapsed.
 */
export const SHELL_FLOATING_TRIGGER_CLASS =
	'sidebar-collapsed-trigger absolute top-2.5 left-[var(--ensemblr-window-chrome-inset-start)] z-20';

/**
 * Tailwind class for the height every top bar shares, read from the same custom
 * property `.native-toolbar` uses. For the strips that are not `.native-toolbar`
 * — the sidebar's own title bar, the maximized Concierge header — this is what
 * keeps them level with the bars beside them instead of two pixels off.
 */
export const TOOLBAR_HEIGHT_CLASS = 'h-(--ensemblr-toolbar-height)';
