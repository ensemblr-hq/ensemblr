import { createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';

import { RunScriptsSection } from '@/renderer/components/settings/run-scripts/run-scripts-section';
import { SettingRow } from '@/renderer/components/settings/setting-row';
import { SettingsSection } from '@/renderer/components/settings/settings-section';
import {
	RadioGroup,
	RadioGroupItem,
} from '@/renderer/components/ui/radio-group';
import { Switch } from '@/renderer/components/ui/switch';
import { Textarea } from '@/renderer/components/ui/textarea';
import { useRepoSettings } from '@/renderer/hooks/use-repo-settings';
import { useScriptsSettingsForm } from '@/renderer/hooks/use-scripts-settings-form';
import type { RepoSettingsKey } from '@/renderer/state/preferences';
import type {
	RepoProject,
	RunMode,
	ScriptsForm,
} from '@/renderer/types/settings';
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
				{null}
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

/** The live Scripts form once settings have loaded; remounted per repo via `key`. */
function ScriptsEditor({
	initial,
	project,
	repoId,
	workspaceDiverges,
}: {
	initial: ScriptsForm;
	project: RepoProject;
	repoId: string;
	/** True when the open workspace's branch commits different scripts. */
	workspaceDiverges: boolean;
}) {
	const { t } = useTranslation();
	const { form, updateForm } = useScriptsSettingsForm(repoId, project, initial);

	return (
		<SettingsSection
			description={t(
				'settings:repo.scripts.description',
				'Commands that run when workspaces are set up, run, or archived. Saved to the repository’s committed .ensemblr/settings.toml.',
			)}
			title={t('settings:repo.scripts.title', 'Scripts')}
		>
			{workspaceDiverges ? (
				<p className='pt-4 text-muted-foreground text-xs'>
					{t(
						'settings:repo.scripts.diverges',
						'The workspace you have open commits different scripts on its branch, and runs those. Merge this file to change what it runs.',
					)}
				</p>
			) : null}

			<ScriptRow
				description={t(
					'settings:repo.setup-script.description',
					'Runs when a new workspace is created.',
				)}
				label={t('settings:repo.setup-script.label', 'Setup script')}
				onChange={(value) => updateForm({ setup: value })}
				onReset={() => updateForm({ setup: '' })}
				placeholder={t('settings:repo.setup-script.placeholder', 'e.g. npm ci')}
				value={form.setup}
			/>

			<RunScriptsSection
				onChange={(runScripts) => updateForm({ runScripts })}
				scripts={form.runScripts}
			/>

			<SettingRow
				description={t(
					'settings:repo.run-mode.description',
					'Whether run scripts can run in parallel across workspaces.',
				)}
				label={t('settings:repo.run-mode.label', 'Run mode')}
				stack
			>
				<RadioGroup
					className='mt-2 flex flex-col gap-2'
					onValueChange={(value) => updateForm({ runMode: value as RunMode })}
					value={form.runMode}
				>
					<div className='flex items-start gap-2 text-sm'>
						<RadioGroupItem
							className='mt-0.5'
							id='run-mode-concurrent'
							value='concurrent'
						/>
						<label className='cursor-pointer' htmlFor='run-mode-concurrent'>
							<div>{t('settings:repo.run-mode.concurrent', 'Concurrent')}</div>
							<p className='text-muted-foreground text-xs'>
								{t(
									'settings:repo.run-mode.concurrent-description',
									'Run scripts can run in multiple workspaces at once.',
								)}
							</p>
						</label>
					</div>
					<div className='flex items-start gap-2 text-sm'>
						<RadioGroupItem
							className='mt-0.5'
							id='run-mode-nonconcurrent'
							value='nonconcurrent'
						/>
						<label className='cursor-pointer' htmlFor='run-mode-nonconcurrent'>
							<div>
								{t('settings:repo.run-mode.nonconcurrent', 'Non-concurrent')}
							</div>
							<p className='text-muted-foreground text-xs'>
								{t(
									'settings:repo.run-mode.nonconcurrent-description',
									'Only one run script can run at a time.',
								)}
							</p>
						</label>
					</div>
				</RadioGroup>
			</SettingRow>

			<SettingRow
				control={
					<Switch
						checked={form.autoRun}
						onCheckedChange={(value) => updateForm({ autoRun: value })}
					/>
				}
				description={t(
					'settings:repo.auto-run.description',
					"Start this repository's run script automatically after a new local workspace finishes setup.",
				)}
				label={t('settings:repo.auto-run.label', 'Auto-run after setup')}
			/>

			<ScriptRow
				description={t(
					'settings:repo.archive-script.description',
					'Runs before a workspace is archived.',
				)}
				label={t('settings:repo.archive-script.label', 'Archive script')}
				onChange={(value) => updateForm({ archive: value })}
				onReset={() => updateForm({ archive: '' })}
				placeholder={t(
					'settings:repo.archive-script.placeholder',
					'e.g. rm -rf node_modules',
				)}
				value={form.archive}
			/>
		</SettingsSection>
	);
}

/** One script command editor, cleared by the row's revert control. */
function ScriptRow({
	description,
	label,
	onChange,
	onReset,
	placeholder,
	value,
}: {
	description: string;
	label: string;
	onChange: (next: string) => void;
	onReset: () => void;
	placeholder: string;
	value: string;
}) {
	return (
		<SettingRow
			description={description}
			label={label}
			modified={value.trim().length > 0}
			onReset={onReset}
			stack
		>
			<Textarea
				aria-label={label}
				className='mt-2 min-h-18 font-mono text-xs'
				onChange={(event) => onChange(event.target.value)}
				placeholder={placeholder}
				value={value}
			/>
		</SettingRow>
	);
}
