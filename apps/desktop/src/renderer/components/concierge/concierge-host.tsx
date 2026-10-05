import { useAtom, useSetAtom } from 'jotai';
import { TooltipProvider } from '@/renderer/components/ui/tooltip';
import { useConciergeFocusHandoff } from '@/renderer/hooks/concierge/use-concierge-focus-handoff';
import { useHotkey } from '@/renderer/hooks/use-hotkey';
import {
	conciergePresentationAtom,
	focusConciergeComposerAtom,
	toggleConciergeAtom,
	toggleConciergeFullscreenAtom,
} from '@/renderer/state/concierge';
import {
	useMenuCommand,
	useMenuCommandChecked,
} from '@/renderer/state/menu-commands';
import { ConciergePanel } from './concierge-panel';

/**
 * The Concierge's one mount in the shell: the panel, plus everything that has
 * to keep working while the panel is shut.
 *
 * What opens it on screen is `ConciergeToggleRow`, which each screen places in
 * its own bottom-right corner; this host draws nothing of its own while the
 * Concierge is closed, so a screen without a toggle still answers the chord.
 *
 * It carries its own `TooltipProvider` rather than relying on the one the
 * workbench frame installs. The composer reuses the workspace composer's model
 * and thinking pickers, both of which render tooltips, so a Concierge mounted
 * anywhere but inside that frame threw on open. Nesting a second provider is
 * what Radix expects when a subtree owns its own requirements.
 *
 * It does need to sit inside the frame's `SidebarProvider`, though: maximized,
 * the panel covers the toolbar hosting the shell's expand trigger, so its header
 * offers one of its own while the sidebar is collapsed.
 *
 * It also owns the three Concierge commands that have to work with the panel
 * shut — open, maximize, and focus the composer — as both a shortcut and a
 * native-menu item driven by the same callback, which is what lets the menu
 * claim their chords, plus the focus handoff into and back out of the panel.
 */
export function ConciergeHost() {
	const [presentation] = useAtom(conciergePresentationAtom);
	const toggle = useSetAtom(toggleConciergeAtom);
	const toggleFullscreen = useSetAtom(toggleConciergeFullscreenAtom);
	const focusComposer = useSetAtom(focusConciergeComposerAtom);

	// Registered here rather than in the panel because the host outlives it: a
	// chord that only worked once the Concierge was already open could not be
	// what opens it, and a menu item registered by the panel would grey out
	// exactly when the user wants it.
	useHotkey('concierge.toggle', toggle);
	useMenuCommand('concierge.toggle', toggle);
	useMenuCommandChecked('concierge.toggle', presentation !== 'closed');
	useHotkey('concierge.toggleFullscreen', toggleFullscreen);
	useMenuCommand('concierge.toggleFullscreen', toggleFullscreen);
	useMenuCommandChecked(
		'concierge.toggleFullscreen',
		presentation === 'fullscreen',
	);
	useHotkey('concierge.focusComposer', focusComposer);
	useMenuCommand('concierge.focusComposer', focusComposer);

	// Here rather than in the panel for the same reason: the handoff has to see
	// the presentation change *before* the panel mounts to record where focus was,
	// and still be alive after it unmounts to give it back.
	useConciergeFocusHandoff(presentation);

	return (
		<TooltipProvider>
			<ConciergePanel />
		</TooltipProvider>
	);
}
