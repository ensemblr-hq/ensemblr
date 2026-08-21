import { cva, type VariantProps } from 'class-variance-authority';
import { Loader2Icon } from 'lucide-react';
import { Slot } from 'radix-ui';
import type * as React from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/renderer/lib/utils';

const buttonVariants = cva(
	"group/button inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-all outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 data-[pending=true]:[&>svg:not([data-slot=button-spinner])]:hidden [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
	{
		variants: {
			variant: {
				default: 'bg-primary text-primary-foreground hover:bg-primary/80',
				outline:
					'border-border bg-background hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:border-input dark:bg-input/30 dark:hover:bg-input/50',
				secondary:
					'bg-secondary text-secondary-foreground hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)] aria-expanded:bg-secondary aria-expanded:text-secondary-foreground',
				ghost:
					'hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground aria-pressed:bg-muted aria-pressed:text-foreground dark:hover:bg-muted/50',
				subtle:
					'text-muted-foreground hover:bg-foreground/5 hover:text-muted-foreground data-[state=open]:bg-foreground/5 data-[state=open]:text-muted-foreground aria-expanded:bg-foreground/5 aria-expanded:text-muted-foreground aria-pressed:bg-foreground/5 aria-pressed:text-muted-foreground',
				destructive:
					'bg-destructive/10 text-destructive hover:bg-destructive/20 focus-visible:border-destructive/40 focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:hover:bg-destructive/30 dark:focus-visible:ring-destructive/40',
				link: 'text-primary underline-offset-4 hover:underline',
			},
			size: {
				default:
					'h-8 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2',
				xs: "h-6 gap-1 rounded-[min(var(--radius-md),0.625rem)] px-2 text-xs in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
				sm: "h-7 gap-1 rounded-[min(var(--radius-md),0.75rem)] px-2.5 text-[0.8rem] in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
				lg: 'h-9 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2',
				icon: 'size-8',
				'icon-xs':
					"size-6 rounded-[min(var(--radius-md),0.625rem)] in-data-[slot=button-group]:rounded-lg [&_svg:not([class*='size-'])]:size-3",
				'icon-sm':
					'size-7 rounded-[min(var(--radius-md),0.75rem)] in-data-[slot=button-group]:rounded-lg',
				'icon-lg': 'size-9',
			},
		},
		defaultVariants: {
			variant: 'default',
			size: 'default',
		},
	},
);

/**
 * Restates the in-flight run inside the button, where assistive tech folds it
 * into the accessible name: `button` takes presentational children, so a live
 * region here would be flattened rather than announced. Split out of `Button`
 * so an idle button never subscribes to the i18n instance.
 */
function ButtonPendingLabel() {
	const { t } = useTranslation();

	return (
		<span className='sr-only'>
			{t('common:actions.in-progress', 'In progress')}
		</span>
	);
}

type ButtonProps = React.ComponentProps<'button'> &
	VariantProps<typeof buttonVariants> &
	(
		| {
				asChild: true;
				/**
				 * Unsupported alongside `asChild`: a slotted element is not
				 * necessarily a `<button>`, so there is no `disabled` to set and the
				 * spinner cannot be injected without displacing the slot's only child.
				 */
				pending?: never;
		  }
		| {
				asChild?: false;
				/**
				 * Reports the button's action as in flight: it renders a spinner in
				 * place of whatever icon the caller passed, keeps the idle label so the
				 * button never changes meaning mid-run, adds a screen-reader-only "In
				 * progress" so the run stays in the accessible name, and disables
				 * itself. Not part of shadcn's button — the base class hides the
				 * caller's own icon by matching the `data-slot="button-spinner"` this
				 * sets.
				 *
				 * A button carrying a leading icon holds its width exactly, since the
				 * spinner replaces that icon one for one. A label-only button gains the
				 * spinner's width, the same way a leading icon would have widened it.
				 */
				pending?: boolean;
		  }
	);

function Button({
	className,
	variant = 'default',
	size = 'default',
	asChild = false,
	pending = false,
	children,
	...props
}: ButtonProps) {
	if (asChild) {
		return (
			<Slot.Root
				data-slot='button'
				data-variant={variant}
				data-size={size}
				className={cn(buttonVariants({ variant, size, className }))}
				{...props}
			>
				{children}
			</Slot.Root>
		);
	}

	return (
		<button
			data-slot='button'
			data-variant={variant}
			data-size={size}
			data-pending={pending || undefined}
			aria-busy={pending || undefined}
			className={cn(buttonVariants({ variant, size, className }))}
			{...props}
			disabled={props.disabled || pending}
		>
			{pending ? (
				<Loader2Icon
					aria-hidden='true'
					className='animate-spin'
					data-icon='inline-start'
					data-slot='button-spinner'
				/>
			) : null}
			{children}
			{pending ? <ButtonPendingLabel /> : null}
		</button>
	);
}

export { Button, buttonVariants };
