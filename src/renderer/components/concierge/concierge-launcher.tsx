import { useAtom, useSetAtom } from 'jotai';
import { Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/renderer/components/ui/button';
import { TooltipProvider } from '@/renderer/components/ui/tooltip';
import { useConciergeAnchor } from '@/renderer/hooks/concierge/use-concierge-anchor';
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

/** Launcher size in pixels, matching the `size-*` class below. */
const LAUNCHER_SIZE = { height: 44, width: 44 };

/**
 * The Concierge's entry point: a draggable floating launcher that opens the
 * panel, plus the panel itself.
 *
 * Both live here so one mount in the shell layout carries the whole surface. The
 * launcher hides while the panel is open — the panel owns its own close control,
 * and a bubble underneath it would be a second way to do the same thing in the
 * same place.
 *
 * The bubble is both a drag handle and a button, which is why the anchor hook
 * has a movement threshold: a press that never travels opens the panel, and one
 * that does moves the bubble without opening anything. Bubble and panel hang
 * from the one shared corner that hook owns, so the panel opens where the bubble
 * was and closing puts the bubble back where the panel was left.
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
export function ConciergeLauncher() {
	const { t } = useTranslation();
	const [presentation] = useAtom(conciergePresentationAtom);
	const toggle = useSetAtom(toggleConciergeAtom);
	const toggleFullscreen = useSetAtom(toggleConciergeFullscreenAtom);
	const focusComposer = useSetAtom(focusConciergeComposerAtom);

	// Registered here rather than in the panel because the launcher outlives it:
	// a chord that only worked once the Concierge was already open could not be
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

	const anchor = useConciergeAnchor<HTMLButtonElement>({ size: LAUNCHER_SIZE });

	return (
		<TooltipProvider>
			{presentation === 'closed' ? (
				<Button
					aria-label={t(
						'workbench:concierge.launcher.open',
						'Open the Concierge',
					)}
					// The button's own base style transitions *all* properties, which
					// includes the `left`/`top` a drag writes every frame — so the bubble
					// eased toward the cursor a transition-duration behind it. Naming the
					// properties keeps the hover and focus polish without the position.
					className='fixed z-40 size-11 cursor-grab rounded-full shadow-lg transition-[background-color,border-color,box-shadow] active:cursor-grabbing'
					onClick={() => {
						if (!anchor.isDragging()) {
							toggle();
						}
					}}
					onPointerDown={anchor.onPointerDown}
					ref={anchor.ref}
					size='icon'
				>
					<Sparkles aria-hidden='true' className='size-5' />
				</Button>
			) : null}
			<ConciergePanel />
		</TooltipProvider>
	);
}
