import { cva, type VariantProps } from 'class-variance-authority';
import type * as React from 'react';

import { cn } from '@/renderer/lib/utils';

const textareaVariants = cva(
	'field-sizing-content flex min-h-16 w-full text-base outline-none transition-colors placeholder:text-muted-foreground focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40',
	{
		defaultVariants: {
			variant: 'default',
		},
		variants: {
			variant: {
				bare: 'bg-transparent dark:bg-transparent',
				default:
					'rounded-lg border border-input bg-transparent px-2.5 py-2 focus-visible:border-ring disabled:bg-input/50 dark:bg-input/30 dark:disabled:bg-input/80',
			},
		},
	},
);

interface TextareaProps
	extends React.ComponentProps<'textarea'>,
		VariantProps<typeof textareaVariants> {}

function Textarea({ className, variant, ...props }: TextareaProps) {
	return (
		<textarea
			data-slot='textarea'
			className={cn(textareaVariants({ variant, className }))}
			{...props}
		/>
	);
}

export { Textarea, textareaVariants };
