import { createFileRoute } from '@tanstack/react-router';
import type { TFunction } from 'i18next';
import { useAtom } from 'jotai';
import { Trans, useTranslation } from 'react-i18next';
import { ActionPreferenceItem } from '@/renderer/components/settings/action-preference-item';
import { SettingsSection } from '@/renderer/components/settings/settings-section';
import { Accordion } from '@/renderer/components/ui/accordion';
import { useRepoSettings } from '@/renderer/hooks/use-repo-settings';
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
