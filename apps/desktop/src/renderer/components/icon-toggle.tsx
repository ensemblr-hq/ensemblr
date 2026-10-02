import type { ReactNode } from 'react';

import { Button } from '@/renderer/components/ui/button';
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from '@/renderer/components/ui/tooltip';

/** Inputs for {@link IconToggle}: its pressed state, icon, and the action it performs. */
interface IconToggleProps {
	active: boolean;
	/** The icon rendered inside the button. */
	children: ReactNode;
	disabled?: boolean;
	/** Names the action a click performs, not the current state. */
	label: string;
	onClick: () => void;
}

/**
 * A single ghost icon toggle with a tooltip, highlighted when active. The label
 * doubles as the accessible name and the tooltip text, so it should read as the
 * action a click performs ("Enable word wrap") rather than the current state.
 */
export function IconToggle({
	active,
	children,
	disabled,
	label,
	onClick,
}: IconToggleProps) {
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<Button
					aria-label={label}
					aria-pressed={active}
					className='size-7 [&_svg]:size-4'
					disabled={disabled}
					onClick={onClick}
					size='icon-sm'
					variant={active ? 'secondary' : 'ghost'}
				>
					{children}
				</Button>
			</TooltipTrigger>
			<TooltipContent>{label}</TooltipContent>
		</Tooltip>
	);
}
