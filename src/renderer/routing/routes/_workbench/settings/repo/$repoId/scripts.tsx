import { createFileRoute } from '@tanstack/react-router';

import { SettingRow } from '@/renderer/components/settings/setting-row';
import { SettingsSection } from '@/renderer/components/settings/settings-section';
import { SourceBadge } from '@/renderer/components/settings/source-badge';
import {
	RadioGroup,
	RadioGroupItem,
} from '@/renderer/components/ui/radio-group';
import { Switch } from '@/renderer/components/ui/switch';
import { Textarea } from '@/renderer/components/ui/textarea';
import { useRepoSettings } from '@/renderer/hooks/use-repo-settings';
import {
	type RepoProject,
	type RunMode,
	type ScriptsForm,
	useScriptsSettingsForm,
} from '@/renderer/hooks/use-scripts-settings-form';
import type { ResolvedSettingSnapshot } from '@/shared/ipc/contracts/settings-resolution';

export const Route = createFileRoute(
	'/_workbench/settings/repo/$repoId/scripts',
)({
	component: RepoScriptsSettings,
});

/** Typed `resolved(key)` lookup returned by {@link useRepoSettings}. */
type ResolveSetting = ReturnType<typeof useRepoSettings>['resolved'];

const SCRIPTS_DESCRIPTION =
	'Commands that run when workspaces are set up, run, or archived.';

/**
 * Per-repository Scripts settings. Reads the resolved values (which prefer the
 * committed `.ensemble/settings.toml` over personal SQLite) to seed the editor
 * and render source badges. The editor is remounted per repo via `key` once the
 * snapshot has loaded, so its initial values seed from render state instead of a
 * derive-into-state effect.
 */
function RepoScriptsSettings() {
	const { repoId } = Route.useParams();
	const { resolved, project } = useRepoSettings(repoId);

	// runScriptMode always resolves (built-in default) once the snapshot loads.
	const settingsLoaded = resolved('runScriptMode') !== undefined;

	if (!settingsLoaded) {
		return (
			<SettingsSection description={SCRIPTS_DESCRIPTION} title='Scripts'>
				{null}
			</SettingsSection>
		);
	}

	const initial: ScriptsForm = {
		archive: (resolved('scripts.archive')?.value as string) ?? '',
		autoRun: resolved('autoRunAfterSetup')?.value === true,
		run: (resolved('scripts.run')?.value as string) ?? '',
		runMode: (resolved('runScriptMode')?.value as RunMode) ?? 'concurrent',
		setup: (resolved('scripts.setup')?.value as string) ?? '',
	};

	return (
		<ScriptsEditor
			initial={initial}
			key={repoId}
			project={project}
			repoId={repoId}
			resolved={resolved}
		/>
	);
}

/** The live Scripts form once settings have loaded; remounted per repo via `key`. */
function ScriptsEditor({
	initial,
	project,
	repoId,
	resolved,
}: {
	initial: ScriptsForm;
	project: RepoProject;
	repoId: string;
	resolved: ResolveSetting;
}) {
	const { form, updateForm } = useScriptsSettingsForm(repoId, project, initial);

	return (
		<SettingsSection description={SCRIPTS_DESCRIPTION} title='Scripts'>
			<ScriptRow
				description='Runs when a new workspace is created.'
				label='Setup script'
				onChange={(value) => updateForm({ setup: value })}
				placeholder='e.g. bun install'
				source={resolved('scripts.setup')?.source}
				value={form.setup}
			/>

			<ScriptRow
				description='Runs when you click the play button.'
				label='Run script'
				onChange={(value) => updateForm({ run: value })}
				placeholder='e.g. bun run dev'
				source={resolved('scripts.run')?.source}
				value={form.run}
			/>

			<SettingRow
				description='Whether run scripts can run in parallel across workspaces.'
				label={
					<span className='flex items-center gap-2'>
						Run mode
						<SourceBadge source={resolved('runScriptMode')?.source} />
					</span>
				}
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
							<div>Concurrent</div>
							<p className='text-muted-foreground text-xs'>
								Run scripts can run in multiple workspaces at once.
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
							<div>Non-concurrent</div>
							<p className='text-muted-foreground text-xs'>
								Only one run script can run at a time.
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
				description="Start this repository's run script automatically after a new local workspace finishes setup."
				label='Auto-run after setup'
			/>

			<ScriptRow
				description='Runs before a workspace is archived.'
				label='Archive script'
				onChange={(value) => updateForm({ archive: value })}
				placeholder='e.g. rm -rf node_modules'
				source={resolved('scripts.archive')?.source}
				value={form.archive}
			/>
		</SettingsSection>
	);
}

/** Props for {@link ScriptRow}. */
interface ScriptRowProps {
	description: string;
	label: string;
	onChange: (next: string) => void;
	placeholder: string;
	source: ResolvedSettingSnapshot['source'] | undefined;
	value: string;
}

/** One script command editor with a source badge and toml-override hint. */
function ScriptRow({
	description,
	label,
	onChange,
	placeholder,
	source,
	value,
}: ScriptRowProps) {
	const overriddenByToml = source === 'ensemble-config';

	return (
		<SettingRow
			description={description}
			label={
				<span className='flex items-center gap-2'>
					{label}
					<SourceBadge source={source} />
				</span>
			}
			stack
		>
			<Textarea
				aria-label={label}
				className='mt-2 min-h-18 font-mono text-xs'
				onChange={(event) => onChange(event.target.value)}
				placeholder={placeholder}
				value={value}
			/>
			{overriddenByToml ? (
				<p className='mt-1 text-muted-foreground text-xs'>
					Overridden by the committed .ensemble/settings.toml; your edit is
					saved but shadowed until that key is removed.
				</p>
			) : null}
		</SettingRow>
	);
}
