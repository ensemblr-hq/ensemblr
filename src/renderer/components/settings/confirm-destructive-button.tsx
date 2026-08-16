import { useState } from 'react';

import { Button } from '@/renderer/components/ui/button';
import { cn } from '@/renderer/lib/utils';

/** Props for a destructive action gated behind a second, confirming click. */
interface ConfirmDestructiveButtonProps {
	/** Label shown once the first click has armed the button. */
	armedLabel: string;
	disabled: boolean;
	label: string;
	onConfirm: () => void;
	size: 'sm' | 'xs';
}

/**
 * Destructive action gated behind a second click on the same button. Arming in
 * place keeps the row from reflowing the way an inline dialog would, and the
 * label change is what tells the user the next click is the real one. Blurring
 * disarms, so a click elsewhere cannot leave the button primed.
 */
export function ConfirmDestructiveButton({
	armedLabel,
	disabled,
	label,
	onConfirm,
	size,
}: ConfirmDestructiveButtonProps) {
	const [armed, setArmed] = useState(false);

	return (
		<Button
			className={cn(
				'text-muted-foreground hover:bg-destructive/10 hover:text-destructive',
				armed && 'bg-destructive/10 text-destructive',
			)}
			disabled={disabled}
			onBlur={() => setArmed(false)}
			onClick={() => {
				if (!armed) {
					setArmed(true);
					return;
				}

				setArmed(false);
				onConfirm();
			}}
			size={size}
			type='button'
			variant='ghost'
		>
			{armed ? armedLabel : label}
		</Button>
	);
}
