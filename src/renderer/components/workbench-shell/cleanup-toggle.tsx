import type { ReactNode } from 'react';

import { Checkbox } from '@/renderer/components/ui/checkbox';
import { Label } from '@/renderer/components/ui/label';
import { cn } from '@/renderer/lib/utils';

/** Props for the opt-in destructive cleanup row rendered by the archive dialogs. */
interface CleanupToggleProps {
	checked: boolean;
	description: ReactNode;
	disabled: boolean;
	label: string;
	onCheckedChange: (checked: boolean) => void;
}

/**
 * Opt-in cleanup row for the archive dialogs. Wrapping the checkbox in the label
 * makes the whole row — description included — a single click target, and the row
 * tints while the destructive option is armed.
 */
export function CleanupToggle({
	checked,
	description,
	disabled,
	label,
	onCheckedChange,
}: CleanupToggleProps) {
	return (
		<Label
			className={cn(
				'grid cursor-pointer grid-cols-[auto_minmax(0,1fr)] items-start gap-x-2.5 gap-y-1 rounded-md border px-3 py-2.5 transition-colors has-disabled:cursor-default has-disabled:opacity-60',
				checked
					? 'border-destructive/30 bg-destructive/5'
					: 'border-border bg-background hover:bg-muted/40',
			)}
		>
			<Checkbox
				checked={checked}
				disabled={disabled}
				onCheckedChange={(value) => onCheckedChange(value === true)}
			/>
			<span className='text-xs leading-4'>{label}</span>
			<span className='col-start-2 font-normal text-[0.6875rem] text-muted-foreground leading-normal'>
				{description}
			</span>
		</Label>
	);
}
