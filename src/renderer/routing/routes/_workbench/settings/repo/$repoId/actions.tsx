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
import { Switch } from '@/renderer/components/ui/switch';
import { Textarea } from '@/renderer/components/ui/textarea';
import {
	REPO_ACTION_KEYS,
	type RepoActionKey,
	repoSettingsOverrideAtomFamily,
} from '@/renderer/state/preferences';

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
			'Instructions sent to the agent at the start of every new chat.',
	},
};

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
				control={
					<Switch
						checked={overrides.useSpotlight ?? false}
						onCheckedChange={(v) =>
							setOverrides((prev) => ({ ...prev, useSpotlight: v }))
						}
					/>
				}
				description='Replace Run with Spotlight for this repository so workspace changes are tested in the repository root. Spotlight discovery is in progress; see docs/product/discovery-spotlight-testing.md.'
				label='Use spotlight testing'
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
