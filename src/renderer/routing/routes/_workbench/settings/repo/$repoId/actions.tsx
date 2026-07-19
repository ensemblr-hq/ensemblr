import { createFileRoute } from '@tanstack/react-router';
import { useAtom } from 'jotai';
import { Undo2Icon } from 'lucide-react';
import { SettingRow } from '@/renderer/components/settings/setting-row';
import { SettingsSection } from '@/renderer/components/settings/settings-section';
import {
	Accordion,
	AccordionContent,
	AccordionItem,
	AccordionTrigger,
} from '@/renderer/components/ui/accordion';
import { Badge } from '@/renderer/components/ui/badge';
import { Switch } from '@/renderer/components/ui/switch';
import { Textarea } from '@/renderer/components/ui/textarea';
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from '@/renderer/components/ui/tooltip';
import {
	REPO_ACTION_KEYS,
	type RepoActionKey,
	repoSettingsOverrideAtomFamily,
} from '@/renderer/state/preferences';

/** Route for a repository's Actions settings; renders the per-repo action-preferences panel keyed by the `repoId` path param. */
export const Route = createFileRoute(
	'/_workbench/settings/repo/$repoId/actions',
)({
	component: RepoActionsSettings,
});

const ACTION_META: Record<
	RepoActionKey,
	{ title: string; description: string }
> = {
	codeReview: {
		title: 'Code review preferences',
		description:
			'Add custom instructions sent to the agent when you click the Review button.',
	},
	createPr: {
		title: 'Create PR preferences',
		description:
			'Add custom instructions sent to the agent when you click the Create PR button.',
	},
	fixErrors: {
		title: 'Fix errors preferences',
		description:
			'Add custom instructions sent to the agent when you click the Fix errors button.',
	},
	resolveConflicts: {
		title: 'Resolve conflicts preferences',
		description:
			'Add custom instructions sent to the agent when you click the Resolve conflicts button.',
	},
	branchRename: {
		title: 'Branch rename preferences',
		description:
			'Custom instructions for generating branch names from your messages.',
	},
	general: {
		title: 'General preferences',
		description:
			'A master prompt prepended as context to the first message of every new chat in this repository.',
	},
};

/** Repository-scoped Actions settings panel for spotlight testing and per-action agent instruction overrides. */
function RepoActionsSettings() {
	const { repoId } = Route.useParams();
	const [overrides, setOverrides] = useAtom(
		repoSettingsOverrideAtomFamily(repoId),
	);

	const clearPref = (key: RepoActionKey) =>
		setOverrides((prev) => {
			const { [key]: _removed, ...rest } = prev.actionPreferences ?? {};
			return { ...prev, actionPreferences: rest };
		});

	return (
		<SettingsSection
			description='Configure action-specific behavior and instructions for this repository.'
			title='Actions'
		>
			<SettingRow
				control={<Switch checked={false} disabled />}
				description='Replace Run with Spotlight for this repository so workspace changes are tested in the repository root. Spotlight is a separate feature still in development (workspace→root diff/apply with rollback); see docs/product/discovery-spotlight-testing.md.'
				label={
					<span className='flex items-center gap-2'>
						Use spotlight testing
						<Badge variant='outline'>Coming soon</Badge>
					</span>
				}
			/>

			<Accordion collapsible type='single'>
				{REPO_ACTION_KEYS.map((key) => {
					const meta = ACTION_META[key];
					const hasValue = Boolean(overrides.actionPreferences?.[key]?.trim());
					return (
						<AccordionItem
							className='group/pref relative'
							key={key}
							value={key}
						>
							{hasValue ? (
								<span
									aria-hidden='true'
									className='absolute top-4 bottom-4 -left-4 w-0.5 rounded-full bg-accent-strong'
								/>
							) : null}
							{hasValue ? (
								<Tooltip>
									<TooltipTrigger asChild>
										<button
											aria-label={`Remove ${meta.title}`}
											className='absolute top-4 right-10 z-10 inline-flex size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring group-hover/pref:opacity-100'
											onClick={(e) => {
												e.stopPropagation();
												clearPref(key);
											}}
											type='button'
										>
											<Undo2Icon aria-hidden='true' className='size-3.5' />
										</button>
									</TooltipTrigger>
									<TooltipContent>Remove</TooltipContent>
								</Tooltip>
							) : null}
							<AccordionTrigger className='py-4 hover:no-underline'>
								<div className='flex flex-col items-start gap-0.5 text-left'>
									<span className='flex items-center gap-1.5 font-medium text-sm'>
										{meta.title}
									</span>
									<span className='text-muted-foreground text-xs'>
										{meta.description}
									</span>
								</div>
							</AccordionTrigger>
							<AccordionContent className='px-1 pt-0.5'>
								<Textarea
									aria-label={meta.title}
									className='min-h-22 font-mono text-xs'
									onChange={(e) =>
										setOverrides((prev) => ({
											...prev,
											actionPreferences: {
												...(prev.actionPreferences ?? {}),
												[key]: e.target.value,
											},
										}))
									}
									placeholder='Add your preferences here. The agent will be told to prioritize these instructions over its default instructions.'
									value={overrides.actionPreferences?.[key] ?? ''}
								/>
							</AccordionContent>
						</AccordionItem>
					);
				})}
			</Accordion>
		</SettingsSection>
	);
}
