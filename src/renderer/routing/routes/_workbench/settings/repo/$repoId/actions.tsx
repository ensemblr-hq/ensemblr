import { createFileRoute } from '@tanstack/react-router';
import type { TFunction } from 'i18next';
import { useAtom } from 'jotai';
import { Undo2Icon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
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

/**
 * Titles and descriptions for the per-action instruction overrides. Built from
 * `t()` rather than a module-scope table so a language change re-renders them
 * and so `i18next-cli extract` can see every key statically.
 * @param t - Translation function from `useTranslation`
 * @returns The display copy for every repo action, keyed by action
 */
function actionMeta(
	t: TFunction,
): Record<RepoActionKey, { title: string; description: string }> {
	return {
		branchRename: {
			description: t(
				'settings:repo.actions.branch-rename-description',
				'Custom instructions for generating branch names from your messages.',
			),
			title: t(
				'settings:repo.actions.branch-rename-title',
				'Branch rename preferences',
			),
		},
		codeReview: {
			description: t(
				'settings:repo.actions.code-review-description',
				'Add custom instructions sent to the agent when you click the Review button.',
			),
			title: t(
				'settings:repo.actions.code-review-title',
				'Code review preferences',
			),
		},
		createPr: {
			description: t(
				'settings:repo.actions.create-pr-description',
				'Add custom instructions sent to the agent when you click the Create PR button.',
			),
			title: t(
				'settings:repo.actions.create-pr-title',
				'Create PR preferences',
			),
		},
		fixErrors: {
			description: t(
				'settings:repo.actions.fix-errors-description',
				'Add custom instructions sent to the agent when you click the Fix errors button.',
			),
			title: t(
				'settings:repo.actions.fix-errors-title',
				'Fix errors preferences',
			),
		},
		general: {
			description: t(
				'settings:repo.actions.general-description',
				'A master prompt prepended as context to the first message of every new chat in this repository.',
			),
			title: t('settings:repo.actions.general-title', 'General preferences'),
		},
		resolveConflicts: {
			description: t(
				'settings:repo.actions.resolve-conflicts-description',
				'Add custom instructions sent to the agent when you click the Resolve conflicts button.',
			),
			title: t(
				'settings:repo.actions.resolve-conflicts-title',
				'Resolve conflicts preferences',
			),
		},
	};
}

/** Repository-scoped Actions settings panel for spotlight testing and per-action agent instruction overrides. */
function RepoActionsSettings() {
	const { t } = useTranslation();
	const { repoId } = Route.useParams();
	const [overrides, setOverrides] = useAtom(
		repoSettingsOverrideAtomFamily(repoId),
	);
	const meta = actionMeta(t);

	const clearPref = (key: RepoActionKey) =>
		setOverrides((prev) => {
			const { [key]: _removed, ...rest } = prev.actionPreferences ?? {};
			return { ...prev, actionPreferences: rest };
		});

	return (
		<SettingsSection
			description={t(
				'settings:repo.actions.description',
				'Configure action-specific behavior and instructions for this repository.',
			)}
			title={t('settings:repo.actions.title', 'Actions')}
		>
			<SettingRow
				control={<Switch checked={false} disabled />}
				description={t(
					'settings:repo.spotlight.description',
					'Replace Run with Spotlight for this repository so workspace changes are tested in the repository root. Spotlight is a separate feature still in development (workspace→root diff/apply with rollback); see docs/product/discovery-spotlight-testing.md.',
				)}
				label={
					<span className='flex items-center gap-2'>
						{t('settings:repo.spotlight.label', 'Use spotlight testing')}
						<Badge variant='outline'>
							{t('settings:repo.spotlight.coming-soon', 'Coming soon')}
						</Badge>
					</span>
				}
			/>

			<Accordion collapsible type='single'>
				{REPO_ACTION_KEYS.map((key) => {
					const actionCopy = meta[key];
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
											aria-label={t(
												'settings:repo.actions.remove-aria-label',
												'Remove {{name}}',
												{ name: actionCopy.title },
											)}
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
									<TooltipContent>
										{t('common:actions.remove', 'Remove')}
									</TooltipContent>
								</Tooltip>
							) : null}
							<AccordionTrigger className='py-4 hover:no-underline'>
								<div className='flex flex-col items-start gap-0.5 text-left'>
									<span className='flex items-center gap-1.5 font-medium text-sm'>
										{actionCopy.title}
									</span>
									<span className='text-muted-foreground text-xs'>
										{actionCopy.description}
									</span>
								</div>
							</AccordionTrigger>
							<AccordionContent className='px-1 pt-0.5'>
								<Textarea
									aria-label={actionCopy.title}
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
									placeholder={t(
										'settings:repo.actions.placeholder',
										'Add your preferences here. The agent will be told to prioritize these instructions over its default instructions.',
									)}
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
