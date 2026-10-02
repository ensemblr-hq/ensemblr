import { atom } from 'jotai';

import { readWindowChrome } from '@/renderer/lib/window-chrome';
import type { WindowChromeSnapshot } from '@/shared/window-chrome';

/**
 * The chrome the live window wears, seeded from the bootstrap snapshot and
 * thereafter written only by main's broadcast.
 *
 * Most of it is fixed when the window is constructed, but full screen is not:
 * macOS slides its traffic lights off the window there and the leading inset
 * reserved for them has to go with them, so the shell reads this rather than
 * the one-shot value it started from.
 */
export const windowChromeAtom = atom<WindowChromeSnapshot>(readWindowChrome());
