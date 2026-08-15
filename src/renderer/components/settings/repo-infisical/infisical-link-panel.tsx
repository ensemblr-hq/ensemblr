import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
	clearInfisicalLink,
	ensemblrQueryKeys,
	infisicalAccountsQuery,
	infisicalLinkQuery,
	infisicalProjectsQuery,
	setInfisicalLink,
	syncInfisicalLink,
} from '@/renderer/api/ensemblr';
import { SettingRow } from '@/renderer/components/settings/setting-row';
import { SettingsLoadingState } from '@/renderer/components/settings/settings-async-state';
import { SettingsEmptyState } from '@/renderer/components/settings/settings-empty-state';
import { buttonVariants } from '@/renderer/components/ui/button';
import { Switch } from '@/renderer/components/ui/switch';
import type { InfisicalFailure } from '@/shared/ipc/contracts/infisical';

import { InfisicalFailureText } from './infisical-failure-text';
import {
	InfisicalEnvironmentSelect,
	InfisicalProjectSelect,
	InfisicalSecretPathInput,
} from './infisical-link-fields';
import {
	EMPTY_INFISICAL_DRAFT,
	type InfisicalLinkDraft,
	normalizeSecretPath,
	resolveInfisicalLinkForm,
} from './infisical-link-form';
import { InfisicalLinkSaveBar } from './infisical-link-save-bar';
import { InfisicalLinkSummary } from './infisical-link-summary';
import { InfisicalProjectListNotice } from './infisical-project-list-notice';
import { InfisicalSyncedKeys } from './infisical-synced-keys';

/** The scope every control on this panel reads and writes. */
const LINK_SCOPE = 'repository' as const;

/**
 * Links a repository to an Infisical project. Projects are aggregated across
 * every configured account, so the panel asks which project rather than which
 * account: the account half follows from the project the user picks, and the
 * project half is what gets written to the committed `.ensemblr/settings.toml`.
 */
export function InfisicalLinkPanel({ repoId }: { repoId: string }) {
	const { t } = useTranslation();
	const queryClient = useQueryClient();
	const scopeRequest = { scope: LINK_SCOPE, scopeId: repoId };

	const { data: accountsResult, isLoading: accountsLoading } = useQuery(
		infisicalAccountsQuery,
	);
	const { data: linkResult } = useQuery(infisicalLinkQuery(scopeRequest));
	const { data: projectsResult, isFetching: projectsFetching } = useQuery(
		infisicalProjectsQuery,
	);

	const accounts = accountsResult?.accounts ?? [];
	const link = linkResult?.link ?? null;
	const projects = projectsResult?.projects ?? [];

	const [draft, setDraft] = useState<InfisicalLinkDraft>(EMPTY_INFISICAL_DRAFT);
	const [failure, setFailure] = useState<InfisicalFailure | null>(null);
	const [syncedKeys, setSyncedKeys] = useState<string[] | null>(null);

	const form = resolveInfisicalLinkForm({
		draft,
		link,
		projects,
		projectsLoaded: Boolean(projectsResult) && !projectsFetching,
	});

	/** Refreshes the link after a mutation settles. */
	const invalidateLink = () =>
		queryClient.invalidateQueries({
			queryKey: ensemblrQueryKeys.infisicalLink(LINK_SCOPE, repoId),
		});

	const save = useMutation({
		mutationFn: setInfisicalLink,
		onSuccess: async (result) => {
			setFailure(result.failure);

			if (!result.failure) {
				setDraft(EMPTY_INFISICAL_DRAFT);
			}

			await invalidateLink();
		},
	});

	const clear = useMutation({
		mutationFn: () => clearInfisicalLink(scopeRequest),
		onSuccess: async (result) => {
			setFailure(result.failure);
			setSyncedKeys(null);
			setDraft(EMPTY_INFISICAL_DRAFT);
			await invalidateLink();
		},
	});

	const sync = useMutation({
		mutationFn: () => syncInfisicalLink(scopeRequest),
		onSuccess: async (result) => {
			setFailure(result.failure);
			setSyncedKeys(result.failure ? null : result.keys);
			await invalidateLink();
		},
	});

	if (accountsLoading) {
		return (
			<SettingsLoadingState
				label={t(
					'settings:repo.infisical.loading',
					'Loading your Infisical accounts…',
				)}
			/>
		);
	}

	if (accounts.length === 0) {
		return <NoAccountsState />;
	}

	return (
		<div className='space-y-4 py-5'>
			<InfisicalLinkSummary
				link={link}
				onSync={() => sync.mutate()}
				onUnlink={() => clear.mutate()}
				syncing={sync.isPending}
				unlinking={clear.isPending}
			/>

			<div className='divide-y divide-border border-border border-t'>
				<div>
					<SettingRow
						control={
							<InfisicalProjectSelect
								loading={projectsFetching && projects.length === 0}
								onChange={(projectKey) =>
									setDraft((current) => ({
										...current,
										environmentSlug: null,
										projectKey,
									}))
								}
								projects={projects}
								value={form.projectKey}
							/>
						}
						description={t(
							'settings:repo.infisical.project-description',
							'Written to .ensemblr/settings.toml so everyone who clones this repository points at the same project.',
						)}
						label={t('settings:repo.infisical.project', 'Project')}
					/>
					<InfisicalProjectListNotice
						loading={projectsFetching}
						result={projectsResult ?? null}
						unreachableProjectId={form.unreachableProjectId}
					/>
				</div>

				<SettingRow
					control={
						<InfisicalEnvironmentSelect
							environments={form.environments}
							onChange={(environmentSlug) =>
								setDraft((current) => ({ ...current, environmentSlug }))
							}
							value={form.environmentSlug}
						/>
					}
					description={t(
						'settings:repo.infisical.environment-description',
						'Which Infisical environment this repository resolves against.',
					)}
					label={t('settings:repo.infisical.environment', 'Environment')}
				/>

				<SettingRow
					control={
						<InfisicalSecretPathInput
							onBlur={() =>
								setDraft((current) => ({
									...current,
									secretPath: normalizeSecretPath(form.secretPath),
								}))
							}
							onChange={(secretPath) =>
								setDraft((current) => ({ ...current, secretPath }))
							}
							value={form.secretPath}
						/>
					}
					description={t(
						'settings:repo.infisical.path-description',
						'Folder inside the environment to read. Use / for the root.',
					)}
					htmlFor='infisical-secret-path'
					label={t('settings:repo.infisical.path', 'Secret path')}
				/>

				<SettingRow
					control={
						<Switch
							checked={form.recursive}
							onCheckedChange={(recursive) =>
								setDraft((current) => ({ ...current, recursive }))
							}
						/>
					}
					description={t(
						'settings:repo.infisical.recursive-description',
						'Also read secrets from folders nested under that path.',
					)}
					label={t('settings:repo.infisical.recursive', 'Include sub-folders')}
				/>
			</div>

			<InfisicalLinkSaveBar
				canSave={form.canSave}
				onDiscard={() => setDraft(EMPTY_INFISICAL_DRAFT)}
				onSave={() => {
					if (!form.project || !form.environmentSlug) {
						return;
					}

					save.mutate({
						accountId: form.project.accountId,
						environmentSlug: form.environmentSlug,
						projectId: form.project.id,
						projectName: form.project.name,
						recursive: form.recursive,
						scope: LINK_SCOPE,
						scopeId: repoId,
						secretPath: normalizeSecretPath(form.secretPath),
					});
				}}
				saving={save.isPending}
				visible={form.isDirty}
			/>

			{failure ? <InfisicalFailureText failure={failure} /> : null}
			{syncedKeys ? <InfisicalSyncedKeys keys={syncedKeys} /> : null}
		</div>
	);
}

/**
 * Stands in for the whole panel when no Infisical account is configured yet.
 * Linking is impossible until one exists, so this points at the screen that
 * adds one rather than rendering four dead controls.
 */
function NoAccountsState() {
	const { t } = useTranslation();

	return (
		<div className='py-5'>
			<SettingsEmptyState
				description={t(
					'settings:repo.infisical.no-accounts-description',
					'Ensemblr reads secrets through a Machine Identity. Add one to link this repository to an Infisical project.',
				)}
				title={t(
					'settings:repo.infisical.no-accounts-title',
					'No Infisical account yet',
				)}
			>
				<Link
					className={buttonVariants({ size: 'sm', variant: 'outline' })}
					to='/settings/integrations'
				>
					{t('settings:repo.infisical.no-accounts-action', 'Open Integrations')}
				</Link>
			</SettingsEmptyState>
		</div>
	);
}
