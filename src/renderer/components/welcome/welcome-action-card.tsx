import type { LucideIcon } from 'lucide-react';

import { cn } from '@/renderer/lib/utils';

interface WelcomeActionCardProps {
	className?: string;
	disabled?: boolean;
	icon: LucideIcon;
	label: string;
	onClick?: () => void;
}

/** Square action tile rendered under the welcome wordmark. */
export function WelcomeActionCard({
	className,
	disabled,
	icon: Icon,
	label,
	onClick,
}: WelcomeActionCardProps) {
	return (
		<button
			className={cn(
				'group/welcome-action flex h-32 w-44 flex-col items-start justify-between rounded-xl bg-card p-4 text-left ring-1 ring-foreground/10 transition-colors hover:bg-pane-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-card',
				className,
			)}
			disabled={disabled}
			onClick={onClick}
			type='button'
		>
			<Icon
				aria-hidden='true'
				className='size-5 text-muted-foreground transition-colors group-hover/welcome-action:text-foreground'
			/>
			<span className='font-medium text-foreground text-sm'>{label}</span>
		</button>
	);
}
