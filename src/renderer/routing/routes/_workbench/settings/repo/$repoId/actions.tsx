import { createFileRoute } from '@tanstack/react-router';
import { useAtom } from 'jotai';
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

			<Accordion className='mt-2' collapsible type='single'>
				{REPO_ACTION_KEYS.map((key) => {
					const meta = ACTION_META[key];
					return (
						<AccordionItem key={key} value={key}>
							<AccordionTrigger className='py-3'>
								<div className='flex flex-col items-start gap-0.5 text-left'>
									<span className='font-medium text-sm'>{meta.title}</span>
									<span className='text-muted-foreground text-xs'>
										{meta.description}
									</span>
								</div>
							</AccordionTrigger>
							<AccordionContent>
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
