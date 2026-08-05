import { createFileRoute } from '@tanstack/react-router';
import { PlusIcon, XIcon } from 'lucide-react';

import { SettingRow } from '@/renderer/components/settings/setting-row';
import { SettingsSection } from '@/renderer/components/settings/settings-section';
import { SourceBadge } from '@/renderer/components/settings/source-badge';
import { Button } from '@/renderer/components/ui/button';
import { Input } from '@/renderer/components/ui/input';
import {
	RadioGroup,
	RadioGroupItem,
} from '@/renderer/components/ui/radio-group';
import { Switch } from '@/renderer/components/ui/switch';
import { Textarea } from '@/renderer/components/ui/textarea';
import { useRepoSettings } from '@/renderer/hooks/use-repo-settings';
import { useScriptsSettingsForm } from '@/renderer/hooks/use-scripts-settings-form';
import type {
	RepoProject,
	RunMode,
	ScriptRunTargetFormEntry,
	ScriptsForm,
} from '@/renderer/types/settings';
import type { ResolvedSettingSnapshot } from '@/shared/ipc/contracts/settings-resolution';
import { DEFAULT_RUN_TARGET_ID, readRunTargetEntry } from '@/shared/scripts';

/** Route for a repository's Scripts settings; renders the setup/run/archive script editor keyed by the `repoId` path param. */
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
 * Normalizes a resolved `scripts.run` value (legacy string, array of
 * `{ name?, command, id? }` tables, or absent) into the editable form's row
 * list, assigning a fresh id to any entry that doesn't already carry one so a
 * running session's identity survives a rename. The legacy single-string shape
 * keeps {@link DEFAULT_RUN_TARGET_ID} rather than minting a UUID, so a session
 * already started under that id keeps its dock tab and stop control when the
 * command is first edited here.
 * @param value - Resolved `scripts.run` candidate value.
 * @returns Editable run-target rows, in resolved order.
 */
function parseInitialRunTargets(value: unknown): ScriptRunTargetFormEntry[] {
	if (typeof value === 'string') {
		return value.trim()
			? [{ command: value, id: DEFAULT_RUN_TARGET_ID, name: '' }]
			: [];
	}

	if (!Array.isArray(value)) {
		return [];
	}

	return value.flatMap((entry): ScriptRunTargetFormEntry[] => {
		const raw = readRunTargetEntry(entry);

		if (!raw) {
			return [];
		}

		return [
			{
				command: raw.command,
				id: raw.id || crypto.randomUUID(),
				name: raw.name,
			},
		];
	});
}

/**
 * Per-repository Scripts settings. Reads the resolved values (which prefer the
 * committed `.ensemblr/settings.toml` over personal SQLite) to seed the editor
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
		run: parseInitialRunTargets(resolved('scripts.run')?.value),
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
				onReset={() => updateForm({ setup: '' })}
				placeholder='e.g. bun install'
				source={resolved('scripts.setup')?.source}
				value={form.setup}
			/>

			<RunTargetsEditor
				onChange={(run) => updateForm({ run })}
				source={resolved('scripts.run')?.source}
				targets={form.run}
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
				onReset={() => updateForm({ archive: '' })}
				placeholder='e.g. rm -rf node_modules'
				source={resolved('scripts.archive')?.source}
				value={form.archive}
			/>
		</SettingsSection>
	);
}

/**
 * Editable list of named run targets (ADR 0041): each row is one
 * independently start/stop-able dev-server/watcher command, plus an "Add run
 * target" action. The whole array resolves atomically from one source (TOML
 * vs. personal SQLite vs. built-in), so the source badge and toml-override
 * hint apply to the list as a whole rather than per row.
 */
function RunTargetsEditor({
	onChange,
	source,
	targets,
}: {
	onChange: (next: ScriptRunTargetFormEntry[]) => void;
	source: ResolvedSettingSnapshot['source'] | undefined;
	targets: ScriptRunTargetFormEntry[];
}) {
	const overriddenByToml = source === 'ensemblr-config';
	const isPersonalOverride = source === 'sqlite';

	const updateTarget = (
		id: string,
		patch: Partial<Pick<ScriptRunTargetFormEntry, 'command' | 'name'>>,
	): void => {
		onChange(
			targets.map((target) =>
				target.id === id ? { ...target, ...patch } : target,
			),
		);
	};

	const removeTarget = (id: string): void => {
		onChange(targets.filter((target) => target.id !== id));
	};

	const addTarget = (): void => {
		onChange([...targets, { command: '', id: crypto.randomUUID(), name: '' }]);
	};

	return (
		<SettingRow
			description='Runs when you click the play button. Add more than one to run several dev servers side by side (e.g. one per project in a monorepo).'
			label={
				<span className='flex items-center gap-2'>
					Run scripts
					<SourceBadge source={source} />
				</span>
			}
			modified={isPersonalOverride}
			onReset={() => onChange([])}
			stack
		>
			<div className='mt-2 flex flex-col gap-3'>
				{targets.map((target) => (
					<div
						className='flex flex-col gap-1.5 rounded-md border p-2'
						key={target.id}
					>
						<div className='flex items-center gap-2'>
							<Input
								aria-label='Run target name'
								className='h-7 text-xs'
								onChange={(event) =>
									updateTarget(target.id, { name: event.target.value })
								}
								placeholder='Name (e.g. Web) — optional'
								value={target.name}
							/>
							<Button
								aria-label='Remove run target'
								className='size-7 shrink-0 text-muted-foreground hover:text-foreground'
								onClick={() => removeTarget(target.id)}
								size='icon-xs'
								type='button'
								variant='ghost'
							>
								<XIcon aria-hidden='true' />
							</Button>
						</div>
						<Textarea
							aria-label='Run target command'
							className='min-h-18 font-mono text-xs'
							onChange={(event) =>
								updateTarget(target.id, { command: event.target.value })
							}
							placeholder='e.g. bun run dev'
							value={target.command}
						/>
					</div>
				))}
				<Button
					className='gap-1.5 self-start'
					onClick={addTarget}
					size='xs'
					type='button'
					variant='outline'
				>
					<PlusIcon aria-hidden='true' data-icon='inline-start' />
					Add run target
				</Button>
			</div>
			{overriddenByToml ? (
				<p className='mt-1 text-muted-foreground text-xs'>
					Overridden by the committed .ensemblr/settings.toml; your edit is
					saved but shadowed until that key is removed.
				</p>
			) : null}
		</SettingRow>
	);
}

/** Props for {@link ScriptRow}. */
interface ScriptRowProps {
	description: string;
	label: string;
	onChange: (next: string) => void;
	onReset: () => void;
	placeholder: string;
	source: ResolvedSettingSnapshot['source'] | undefined;
	value: string;
}

/** One script command editor with a source badge and toml-override hint. */
function ScriptRow({
	description,
	label,
	onChange,
	onReset,
	placeholder,
	source,
	value,
}: ScriptRowProps) {
	const overriddenByToml = source === 'ensemblr-config';
	const isPersonalOverride = source === 'sqlite';

	return (
		<SettingRow
			description={description}
			label={
				<span className='flex items-center gap-2'>
					{label}
					<SourceBadge source={source} />
				</span>
			}
			modified={isPersonalOverride}
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
			{overriddenByToml ? (
				<p className='mt-1 text-muted-foreground text-xs'>
					Overridden by the committed .ensemblr/settings.toml; your edit is
					saved but shadowed until that key is removed.
				</p>
			) : null}
		</SettingRow>
	);
}
