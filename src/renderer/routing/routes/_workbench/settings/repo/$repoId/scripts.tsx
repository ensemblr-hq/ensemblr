import { createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';

import { ScriptsEditor } from '@/renderer/components/settings/repo-scripts/scripts-editor';
import { SettingsLoadingState } from '@/renderer/components/settings/settings-async-state';
import { SettingsSection } from '@/renderer/components/settings/settings-section';
import { useRepoSettings } from '@/renderer/hooks/use-repo-settings';
import { useSettingsWorkspaceTarget } from '@/renderer/hooks/use-settings-workspace-target';
import type { RepoSettingsKey } from '@/renderer/state/preferences';
import type { ScriptsForm } from '@/renderer/types/settings';
import {
	type RunScriptDefinition,
	readConfiguredRunScripts,
} from '@/shared/scripts';

/** Route for a repository's Scripts settings; renders the setup/run/archive script editor keyed by the `repoId` path param. */
export const Route = createFileRoute(
	'/_workbench/settings/repo/$repoId/scripts',
)({
	component: RepoScriptsSettings,
});

/** Typed `resolved(key)` lookup returned by {@link useRepoSettings}. */
type ResolveSetting = ReturnType<typeof useRepoSettings>['resolved'];

/**
 * Reads the repository's named run scripts through the shared parser, so a
 * legacy single `scripts.run` command shows up here as the implicit script the
 * dock already launches. Reads the unfiltered list on purpose: the editor saves
 * back what it shows, so a script gated to another environment must survive the
 * round-trip rather than be deleted by the next save.
 * @param resolved - Resolved-settings lookup for this repository.
 * @returns The run scripts to seed the editor with.
 */
function readResolvedRunScripts(
	resolved: ResolveSetting,
): RunScriptDefinition[] {
	return readConfiguredRunScripts([
		{ key: 'scripts.run', value: resolved('scripts.run')?.value },
		{ key: 'scripts.runScripts', value: resolved('scripts.runScripts')?.value },
	]);
}

/**
 * Per-repository Scripts settings. Remounted per repo via `key` so its picked
 * workspace resets when the route param changes.
 */
function RepoScriptsSettings() {
	const { repoId } = Route.useParams();
	return <RepoScriptsSettingsForRepo key={repoId} repoId={repoId} />;
}

/**
 * Reads and writes the committed `.ensemblr/settings.toml` of a live workspace
 * the user picks, since shared repository config is no longer written to the
 * root checkout. The editor is remounted via `key` once the snapshot for the
 * currently selected workspace has loaded, so its initial values seed from
 * render state instead of a derive-into-state effect.
 * @param repoId - Repository whose scripts are being edited.
 */
function RepoScriptsSettingsForRepo({ repoId }: { repoId: string }) {
	const { t } = useTranslation();
	const { selectWorkspace, selectedWorkspaceId, workspaces } =
		useSettingsWorkspaceTarget(repoId);
	const settings = useRepoSettings(repoId, 'workspace', selectedWorkspaceId);

	if (workspaces.length === 0) {
		return (
			<SettingsSection
				description={t(
					'settings:repo.scripts.description',
					'Commands that run when workspaces are set up, run, or archived. Saved to the repository’s committed .ensemblr/settings.toml.',
				)}
				title={t('settings:repo.scripts.title', 'Scripts')}
			>
				<p className='py-4 text-muted-foreground text-xs'>
					{t(
						'settings:repo.scripts.no-workspace',
						'Scripts are saved to a live workspace’s branch. Open a workspace for this repository first.',
					)}
				</p>
			</SettingsSection>
		);
	}

	const snapshotLoaded = settings.resolved('runScriptMode') !== undefined;

	if (!snapshotLoaded || !selectedWorkspaceId) {
		return (
			<SettingsSection
				description={t(
					'settings:repo.scripts.description',
					'Commands that run when workspaces are set up, run, or archived. Saved to the repository’s committed .ensemblr/settings.toml.',
				)}
				title={t('settings:repo.scripts.title', 'Scripts')}
			>
				<SettingsLoadingState
					label={t('settings:repo.scripts.loading', 'Reading scripts…')}
				/>
			</SettingsSection>
		);
	}

	return (
		<ScriptsEditor
			initial={readInitialForm(settings.resolved)}
			key={selectedWorkspaceId}
			onWorkspaceChange={selectWorkspace}
			project={settings.project}
			repoId={repoId}
			selectedWorkspaceId={selectedWorkspaceId}
			workspaces={workspaces}
		/>
	);
}

/**
 * Reads a resolved command into the form, treating a value the resolver did not
 * produce as a string — a hand-edited config can put anything here — as blank.
 * @param resolved - Resolved-settings lookup for this repository.
 * @param key - Resolver key holding the command.
 * @returns The command, or an empty string.
 */
function readCommandField(
	resolved: ResolveSetting,
	key: RepoSettingsKey,
): string {
	const value = resolved(key)?.value;

	return typeof value === 'string' ? value : '';
}

/**
 * Seeds the editor from the selected workspace's resolved snapshot.
 * @param resolved - Resolved-settings lookup for this repository.
 * @returns The form's initial values.
 */
function readInitialForm(resolved: ResolveSetting): ScriptsForm {
	return {
		archive: readCommandField(resolved, 'scripts.archive'),
		autoRun: resolved('autoRunAfterSetup')?.value === true,
		runMode:
			resolved('runScriptMode')?.value === 'nonconcurrent'
				? 'nonconcurrent'
				: 'concurrent',
		runScripts: readResolvedRunScripts(resolved),
		setup: readCommandField(resolved, 'scripts.setup'),
	};
}
