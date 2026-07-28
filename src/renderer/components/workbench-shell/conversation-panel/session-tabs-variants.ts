import { cva } from 'class-variance-authority';

/**
 * Class variants for a session tab shell. The active state owns the surface and
 * text colors; reorderable tabs advertise the drag affordance through the
 * cursor. Edge accents live in `sessionTabIndicatorVariants` rather than on
 * borders, so they never consume layout height.
 *
 * `isolate` scopes those accents to their own tab: motion clears the drag
 * `zIndex` before the drop animation finishes, so without it a sibling's
 * indicator would paint over the settling tab.
 */
const sessionTabVariants = cva(
	'group/session-tab relative isolate m-0 outline-none! flex h-full min-w-30 max-w-44 flex-none items-center overflow-hidden p-0 text-xs transition-colors',
	{
		variants: {
			isActive: {
				true: 'bg-muted text-foreground',
				false: 'bg-background text-muted-foreground hover:text-foreground',
			},
			canReorder: {
				true: 'cursor-grab active:cursor-grabbing',
				false: '',
			},
		},
		defaultVariants: {
			isActive: false,
			canReorder: false,
		},
	},
);

/**
 * Class variants for the 2px accent bars pinned to a tab's top and bottom edge.
 * A `none` tone keeps the bar mounted and transparent so tone changes animate.
 */
const sessionTabIndicatorVariants = cva(
	'pointer-events-none absolute inset-x-0 z-10 h-0.5 transition-colors',
	{
		variants: {
			edge: {
				top: 'top-0',
				bottom: 'bottom-0',
			},
			tone: {
				accent: 'bg-accent-strong',
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
 * Class variants for the hover fade that masks tab text behind the close
 * control, tinted to match the active or inactive tab surface.
 */
const sessionTabCloseFadeVariants = cva(
	'pointer-events-none absolute inset-y-0 right-0 w-16 bg-linear-to-l to-transparent opacity-0 transition-opacity group-hover/session-tab:opacity-100',
	{
		variants: {
			isActive: {
				true: 'from-muted via-muted/90',
				false: 'from-background via-background/90',
			},
		},
		defaultVariants: {
			isActive: false,
		},
	},
);

export {
	sessionTabCloseFadeVariants,
	sessionTabIndicatorVariants,
	sessionTabVariants,
};
