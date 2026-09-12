import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { Dispatch, SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';

import {
	infisicalAccountsQuery,
	infisicalLinkQuery,
	infisicalProjectsQuery,
} from '@/renderer/api/ensemblr';
import { SettingRow } from '@/renderer/components/settings/setting-row';
import { SettingsLoadingState } from '@/renderer/components/settings/settings-async-state';
import { SettingsEmptyState } from '@/renderer/components/settings/settings-empty-state';
import { SettingsWorkspaceTargetRow } from '@/renderer/components/settings/settings-workspace-target-row';
import { buttonVariants } from '@/renderer/components/ui/button';
import { Switch } from '@/renderer/components/ui/switch';
import { useInfisicalLinkMutations } from '@/renderer/hooks/use-infisical-link-mutations';
import { useSettingsWorkspaceTarget } from '@/renderer/hooks/use-settings-workspace-target';
import type { WorkspaceShellModel } from '@/renderer/types/workbench';
import type {
	InfisicalProjectSnapshot,
	InfisicalProjectsResult,
} from '@/shared/ipc/contracts/infisical';

import { InfisicalDiscoveredNotice } from './infisical-discovered-notice';
import { InfisicalFailureText } from './infisical-failure-text';
import {
	InfisicalEnvironmentSelect,
	InfisicalProjectSelect,
	InfisicalSecretPathInput,
} from './infisical-link-fields';
import {
	EMPTY_INFISICAL_DRAFT,
	type InfisicalLinkDraft,
	type InfisicalLinkFormState,
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
 * Links a repository to an Infisical project. The committed half of the link
 * lands on a live workspace's branch rather than in the root clone, so the
 * panel first resolves which workspace that is and refuses when the repository
 * has none.
 */
export function InfisicalLinkPanel({ repoId }: { repoId: string }) {
	const { selectWorkspace, selectedWorkspaceId, workspaces } =
		useSettingsWorkspaceTarget(repoId);

	if (!selectedWorkspaceId) {
		return <NoWorkspaceState />;
	}

	return (
		<InfisicalLinkPanelForWorkspace
			key={selectedWorkspaceId}
			onWorkspaceChange={selectWorkspace}
			repoId={repoId}
			selectedWorkspaceId={selectedWorkspaceId}
			workspaces={workspaces}
		/>
	);
}

/**
 * Links a repository to an Infisical project against one chosen workspace.
 * Projects are aggregated across every configured account, so the panel asks
 * which project rather than which account: the account half follows from the
 * project the user picks, and the project half is what gets written to that
 * workspace's committed `.ensemblr/settings.toml`. Remounted per workspace via
 * `key`, so switching target clears a half-edited draft rather than carrying it
 * onto another branch's link.
 */
function InfisicalLinkPanelForWorkspace({
	onWorkspaceChange,
	repoId,
	selectedWorkspaceId,
	workspaces,
}: {
	/** Switches which live workspace's branch is read and written. */
	onWorkspaceChange: (workspaceId: string) => void;
	repoId: string;
	/** Live workspace whose branch currently carries the committed block. */
	selectedWorkspaceId: string;
	/** Live workspaces of this repository the user can choose between. */
	workspaces: WorkspaceShellModel[];
}) {
	const { t } = useTranslation();
	const scopeRequest = {
		scope: LINK_SCOPE,
		scopeId: repoId,
		workspaceId: selectedWorkspaceId,
	};

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

	const { clear, draft, failure, save, setDraft, sync, syncedKeys } =
		useInfisicalLinkMutations(scopeRequest);

	const form = resolveInfisicalLinkForm({
		accounts,
		draft,
		link,
		projects,
		projectsLoaded: Boolean(projectsResult) && !projectsFetching,
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

			<InfisicalDiscoveredNotice link={link} />

			<div className='divide-y divide-border border-border border-t'>
				<SettingsWorkspaceTargetRow
					description={t(
						'settings:repo.infisical.workspace-target.description',
						'The project half of this link is committed on the chosen workspace’s branch, the same as any other change.',
					)}
					label={t(
						'settings:repo.infisical.workspace-target.label',
						'Save to workspace',
					)}
					onChange={onWorkspaceChange}
					value={selectedWorkspaceId}
					workspaces={workspaces}
				/>

				<InfisicalLinkFormFields
					form={form}
					projects={projects}
					projectsFetching={projectsFetching}
					projectsResult={projectsResult ?? null}
					setDraft={setDraft}
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
						...scopeRequest,
						accountId: form.project.accountId,
						environmentSlug: form.environmentSlug,
						projectId: form.project.id,
						projectName: form.project.name,
						recursive: form.recursive,
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
 * The project, environment, secret path, and recursive rows of the link form.
 * Split out from `InfisicalLinkPanelForWorkspace` purely to keep that
 * component's size manageable; it owns no state of its own beyond what its
 * props hand it.
 */
function InfisicalLinkFormFields({
	form,
	projects,
	projectsFetching,
	projectsResult,
	setDraft,
}: {
	form: InfisicalLinkFormState;
	projects: InfisicalProjectSnapshot[];
	projectsFetching: boolean;
	projectsResult: InfisicalProjectsResult | null;
	setDraft: Dispatch<SetStateAction<InfisicalLinkDraft>>;
}) {
	const { t } = useTranslation();

	return (
		<>
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
					result={projectsResult}
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
		</>
	);
}

/**
 * Stands in for the whole panel when the repository has no live workspace. The
 * project half of a link is committed on a workspace's branch and is never
 * written to the root clone, so there is nowhere for a save to land until one
 * exists.
 */
function NoWorkspaceState() {
	const { t } = useTranslation();

	return (
		<div className='py-5'>
			<SettingsEmptyState
				description={t(
					'settings:repo.infisical.no-workspace-description',
					'The project half of this link is committed to .ensemblr/settings.toml on a live workspace’s branch. Open a workspace for this repository first.',
				)}
				title={t(
					'settings:repo.infisical.no-workspace-title',
					'No live workspace yet',
				)}
			/>
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
