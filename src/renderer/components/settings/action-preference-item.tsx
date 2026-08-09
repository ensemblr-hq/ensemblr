import { Undo2Icon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { SourceBadge } from '@/renderer/components/settings/source-badge';
import {
	AccordionContent,
	AccordionItem,
	AccordionTrigger,
} from '@/renderer/components/ui/accordion';
import { Badge } from '@/renderer/components/ui/badge';
import { Textarea } from '@/renderer/components/ui/textarea';
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from '@/renderer/components/ui/tooltip';
import type { RepoActionKey } from '@/renderer/state/preferences';
import type { SettingsResolutionSource } from '@/shared/ipc/contracts/settings-resolution';

/** Props for {@link ActionPreferenceItem}. */
interface ActionPreferenceItemProps {
	actionKey: RepoActionKey;
	description: string;
	onChange: (value: string) => void;
	onClear: () => void;
	/** The user's own instruction text, empty when they have not set one. */
	personal: string;
	/** The committed `[prompts]` text, shown as placeholder behind the personal one. */
	shared: string;
	sharedSource: SettingsResolutionSource | undefined;
	title: string;
}

/**
 * One action's accordion row: the personal instruction textarea, the resolved
 * team-shared text behind it as placeholder, and the badge naming which of the
 * two the agent will actually send.
 */
export function ActionPreferenceItem({
	actionKey,
	description,
	onChange,
	onClear,
	personal,
	shared,
	sharedSource,
	title,
}: ActionPreferenceItemProps) {
	const { t } = useTranslation();
	const hasPersonal = Boolean(personal.trim());

	return (
		<AccordionItem className='group/pref relative' value={actionKey}>
			{hasPersonal ? (
				<span
					aria-hidden='true'
					className='absolute top-4 bottom-4 -left-4 w-0.5 rounded-full bg-accent-strong'
				/>
			) : null}
			{hasPersonal ? (
				<Tooltip>
					<TooltipTrigger asChild>
						<button
							aria-label={t(
								'settings:repo.actions.remove-aria-label',
								'Remove {{name}}',
								{ name: title },
							)}
							className='absolute top-4 right-10 z-10 inline-flex size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring group-hover/pref:opacity-100'
							onClick={(event) => {
								event.stopPropagation();
								onClear();
							}}
							type='button'
						>
							<Undo2Icon aria-hidden='true' className='size-3.5' />
						</button>
					</TooltipTrigger>
					<TooltipContent>
						{t('common:actions.remove', 'Remove')}
					</TooltipContent>
				</Tooltip>
			) : null}
			<AccordionTrigger className='py-4 hover:no-underline'>
				<div className='flex min-w-0 flex-col items-start gap-1 pr-6 text-left'>
					<span className='flex items-center gap-2 font-medium text-foreground text-sm'>
						{title}
						{hasPersonal ? (
							<Badge className='font-normal text-xxs' variant='outline'>
								{t(
									'settings:repo.actions.source-personal',
									'source: personal (this device)',
								)}
							</Badge>
						) : (
							<SourceBadge source={shared ? sharedSource : undefined} />
						)}
					</span>
					<span className='max-w-prose text-muted-foreground text-xs leading-relaxed'>
						{description}
					</span>
				</div>
			</AccordionTrigger>
			<AccordionContent className='pb-4'>
				<Textarea
					aria-label={title}
					className='min-h-22 font-mono text-xs'
					onChange={(event) => onChange(event.target.value)}
					placeholder={
						shared ||
						t(
							'settings:repo.actions.placeholder',
							'Add your preferences here. The agent will be told to prioritize these instructions over its default instructions.',
						)
					}
					value={personal}
				/>
			</AccordionContent>
		</AccordionItem>
	);
}
