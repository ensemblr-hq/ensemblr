import { cva } from 'class-variance-authority';

/**
 * Class variants for a session tab shell. Both states paint an opaque
 * `bg-background` surface so a lifted or reordered tab never shows its siblings
 * through it; the states differ in text color. Reorderable tabs advertise the
 * drag affordance through the cursor.
 *
 * `isolate` scopes those accents to their own tab: motion clears the drag
 * `zIndex` before the drop animation finishes, so without it a sibling's
 * indicator would paint over the settling tab.
 */
const sessionTabVariants = cva(
	'group/session-tab relative isolate m-0 outline-none! flex h-full flex-none items-center overflow-hidden bg-background p-0 text-xs transition-colors',
	{
		variants: {
			isActive: {
				true: 'text-foreground',
				false: 'text-muted-foreground hover:text-foreground',
			},
			canReorder: {
				true: 'cursor-grab active:cursor-grabbing',
				false: '',
			},
			compact: {
				true: 'w-8 min-w-8 max-w-8',
				false: 'min-w-24 max-w-44',
			},
		},
		defaultVariants: {
			isActive: false,
			canReorder: false,
			compact: false,
		},
	},
);

/** Class variants for the shared 2px active-tab indicator. */
const sessionTabIndicatorVariants = cva(
	'pointer-events-none absolute inset-x-0 bottom-0 z-10 h-0.5 transition-colors',
	{
		variants: {
			tone: {
				active: 'bg-primary',
				none: 'bg-transparent',
			},
		},
		defaultVariants: {
			tone: 'none',
		},
	},
);

/**
 * Hover fade that masks tab text running under the close control. One tint
 * covers both states now that active and inactive tabs share the background.
 */
const SESSION_TAB_CLOSE_FADE_CLASS =
	'pointer-events-none absolute inset-y-0 right-0 w-16 bg-linear-to-l from-background via-background/90 to-transparent opacity-0 transition-opacity group-hover/session-tab:opacity-100';

export {
	SESSION_TAB_CLOSE_FADE_CLASS,
	sessionTabIndicatorVariants,
	sessionTabVariants,
};
