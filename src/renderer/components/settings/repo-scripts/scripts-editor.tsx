import { useTranslation } from 'react-i18next';

import { ScriptRow } from '@/renderer/components/settings/repo-scripts/script-row';
import { RunScriptsSection } from '@/renderer/components/settings/run-scripts/run-scripts-section';
import { SettingRow } from '@/renderer/components/settings/setting-row';
import { SettingsSection } from '@/renderer/components/settings/settings-section';
import {
	RadioGroup,
	RadioGroupItem,
} from '@/renderer/components/ui/radio-group';
import { Switch } from '@/renderer/components/ui/switch';
import { useScriptsSettingsForm } from '@/renderer/hooks/use-scripts-settings-form';
import type {
	RepoProject,
	RunMode,
	ScriptsForm,
} from '@/renderer/types/settings';

/** The live Scripts form once settings have loaded; remounted per repo via `key`. */
export function ScriptsEditor({
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
				<p className='py-4 text-muted-foreground text-xs'>
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
					className='flex flex-col gap-3'
					onValueChange={(value) => updateForm({ runMode: value as RunMode })}
					value={form.runMode}
				>
					<div className='flex items-start gap-2'>
						<RadioGroupItem
							className='mt-0.5'
							id='run-mode-concurrent'
							value='concurrent'
						/>
						<label
							className='cursor-pointer space-y-0.5'
							htmlFor='run-mode-concurrent'
						>
							<span className='block font-medium text-foreground text-sm'>
								{t('settings:repo.run-mode.concurrent', 'Concurrent')}
							</span>
							<span className='block text-muted-foreground text-xs leading-relaxed'>
								{t(
									'settings:repo.run-mode.concurrent-description',
									'Run scripts can run in multiple workspaces at once.',
								)}
							</span>
						</label>
					</div>
					<div className='flex items-start gap-2'>
						<RadioGroupItem
							className='mt-0.5'
							id='run-mode-nonconcurrent'
							value='nonconcurrent'
						/>
						<label
							className='cursor-pointer space-y-0.5'
							htmlFor='run-mode-nonconcurrent'
						>
							<span className='block font-medium text-foreground text-sm'>
								{t('settings:repo.run-mode.nonconcurrent', 'Non-concurrent')}
							</span>
							<span className='block text-muted-foreground text-xs leading-relaxed'>
								{t(
									'settings:repo.run-mode.nonconcurrent-description',
									'Only one run script can run at a time.',
								)}
							</span>
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
