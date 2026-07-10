import type { ReactNode } from 'react';

import { cn } from '@/renderer/lib/utils';

/** Props for a top-level settings page section. */
interface SettingsSectionProps {
	title: string;
	description?: ReactNode;
	action?: ReactNode;
	children: ReactNode;
	className?: string;
}

/** Top-level settings page: title + optional intro + action button + divided row list. */
export function SettingsSection({
	action,
	children,
	className,
	description,
	title,
}: SettingsSectionProps) {
	return (
		<section className={cn('mx-auto w-full max-w-3xl px-8 py-10', className)}>
			<header className='flex items-start justify-between gap-4 pb-2'>
				<div className='min-w-0 flex-1'>
					<h1 className='font-semibold text-2xl tracking-normal'>{title}</h1>
					{description ? (
						<p className='mt-1 text-muted-foreground text-sm leading-6'>
							{description}
						</p>
					) : null}
				</div>
				{action ? <div className='shrink-0'>{action}</div> : null}
			</header>
			<div className='divide-y divide-border'>{children}</div>
		</section>
	);
}
