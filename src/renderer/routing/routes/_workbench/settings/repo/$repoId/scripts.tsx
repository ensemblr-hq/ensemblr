import { createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';

import { ScriptsEditor } from '@/renderer/components/settings/repo-scripts/scripts-editor';
import { SettingsLoadingState } from '@/renderer/components/settings/settings-async-state';
import { SettingsSection } from '@/renderer/components/settings/settings-section';
import { useRepoSettings } from '@/renderer/hooks/use-repo-settings';
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
 * Per-repository Scripts settings. Reads and writes the repository root's
 * committed `.ensemblr/settings.toml`, which is the sole store for these
 * settings and the copy that gets committed and merged. The editor is remounted
 * per repo via `key` once the snapshot has loaded, so its initial values seed
 * from render state instead of a derive-into-state effect.
 */
function RepoScriptsSettings() {
	const { t } = useTranslation();
	const { repoId } = Route.useParams();
	const root = useRepoSettings(repoId, 'root');
	const workspace = useRepoSettings(repoId, 'workspace');

	// runScriptMode always resolves (built-in default) once the snapshot loads.
	const settingsLoaded = root.resolved('runScriptMode') !== undefined;

	if (!settingsLoaded) {
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
			initial={readInitialForm(root.resolved)}
			key={repoId}
			project={root.project}
			repoId={repoId}
			workspaceDiverges={workspaceScriptsDiverge(root, workspace)}
		/>
	);
}

/**
 * Reports whether the open workspace's branch commits different scripts than
 * the repository root. The dock resolves against the worktree, so when the two
 * disagree the screen would otherwise imply it controls what that workspace
 * runs.
 * @param root - Settings bundle resolved against the repository root.
 * @param workspace - Settings bundle resolved against the open workspace.
 * @returns True when the two checkouts resolve different script settings.
 */
function workspaceScriptsDiverge(
	root: ReturnType<typeof useRepoSettings>,
	workspace: ReturnType<typeof useRepoSettings>,
): boolean {
	if (
		!workspace.settingsPath ||
		workspace.settingsPath === root.settingsPath ||
		workspace.resolved('runScriptMode') === undefined
	) {
		return false;
	}

	return (
		JSON.stringify(readInitialForm(root.resolved)) !==
		JSON.stringify(readInitialForm(workspace.resolved))
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
 * Seeds the editor from the repository root's resolved snapshot.
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
