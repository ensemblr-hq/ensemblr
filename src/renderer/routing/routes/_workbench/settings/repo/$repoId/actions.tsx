import { createFileRoute } from '@tanstack/react-router';
import type { TFunction } from 'i18next';
import { useAtom } from 'jotai';
import { Undo2Icon } from 'lucide-react';
import { Trans, useTranslation } from 'react-i18next';
import { SettingsSection } from '@/renderer/components/settings/settings-section';
import { SourceBadge } from '@/renderer/components/settings/source-badge';
import {
	Accordion,
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
import { useRepoSettings } from '@/renderer/hooks/use-repo-settings';
import {
	REPO_ACTION_KEYS,
	type RepoActionKey,
	repoSettingsOverrideAtomFamily,
} from '@/renderer/state/preferences';
import type { SettingsResolutionSource } from '@/shared/ipc/contracts/settings-resolution';

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

/** Repository-scoped Actions settings panel for per-action agent instruction overrides. */
function RepoActionsSettings() {
	const { t } = useTranslation();
	const { repoId } = Route.useParams();
	const { resolved } = useRepoSettings(repoId);
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
			<Accordion collapsible type='single'>
				{REPO_ACTION_KEYS.map((key) => {
					const personal = overrides.actionPreferences?.[key] ?? '';
					const snapshot = resolved(`actionPreferences.${key}`);
					return (
						<ActionPreferenceItem
							actionKey={key}
							description={meta[key].description}
							key={key}
							onChange={(next) =>
								setOverrides((prev) => ({
									...prev,
									actionPreferences: {
										...(prev.actionPreferences ?? {}),
										[key]: next,
									},
								}))
							}
							onClear={() => clearPref(key)}
							personal={personal}
							shared={typeof snapshot?.value === 'string' ? snapshot.value : ''}
							sharedSource={snapshot?.source}
							title={meta[key].title}
						/>
					);
				})}
			</Accordion>

			<p className='py-3 text-muted-foreground text-xs'>
				<Trans
					components={{ file: <code className='font-mono' /> }}
					defaults='The committed <file>[prompts]</file> block in <file>.ensemblr/settings.toml</file> supplies the team-shared text. A personal preference typed here wins over it for you only, and clearing one falls back to the shared text.'
					i18nKey='settings:repo.actions.committed-note'
				/>
			</p>
		</SettingsSection>
	);
}

/**
 * One action's accordion row: the personal instruction textarea, the resolved
 * team-shared text behind it as placeholder, and the badge naming which of the
 * two the agent will actually send.
 */
function ActionPreferenceItem({
	actionKey,
	description,
	onChange,
	onClear,
	personal,
	shared,
	sharedSource,
	title,
}: {
	actionKey: RepoActionKey;
	description: string;
	onChange: (value: string) => void;
	onClear: () => void;
	personal: string;
	shared: string;
	sharedSource: SettingsResolutionSource | undefined;
	title: string;
}) {
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
							<Badge className='text-[0.625rem]' variant='outline'>
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
