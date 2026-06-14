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
import type { ResolvedSettingSnapshot } from '@/shared/ipc/contracts/settings-resolution';

export const Route = createFileRoute(
	'/_workbench/settings/repo/$repoId/scripts',
)({
	component: RepoScriptsSettings,
});

function RepoScriptsSettings() {
	const { repoId } = Route.useParams();
	const { overrides, setOverrides, resolved } = useRepoSettings(repoId);

	const setupResolved = (resolved('setupScript')?.value as string) ?? '';
	const runResolved = (resolved('runScript')?.value as string) ?? '';
	const archiveResolved = (resolved('archiveScript')?.value as string) ?? '';
	const runModeResolved =
		(resolved('runMode')?.value as string) ?? 'concurrent';

	return (
		<SettingsSection
			description='Commands that run when workspaces are set up, run, or archived.'
			title='Scripts'
		>
			<ScriptRow
				label='Setup script'
				description='Runs when a new workspace is created.'
				overrideValue={overrides.setupScript}
				placeholder={setupResolved}
				source={resolved('setupScript')?.source}
				onChange={(value) =>
					setOverrides((prev) => ({ ...prev, setupScript: value }))
				}
			/>

			<ScriptRow
				label='Run script'
				description='Runs when you click the play button.'
				overrideValue={overrides.runScript}
				placeholder={runResolved}
				source={resolved('runScript')?.source}
				onChange={(value) =>
					setOverrides((prev) => ({ ...prev, runScript: value }))
				}
			/>

			<SettingRow
				description='Whether run scripts can run in parallel across workspaces.'
				label={
					<span className='flex items-center gap-2'>
						Run mode
						<SourceBadge source={resolved('runMode')?.source} />
					</span>
				}
				stack
			>
				<RadioGroup
					className='mt-2 flex flex-col gap-2'
					onValueChange={(v) =>
						setOverrides((prev) => ({
							...prev,
							runMode: v as 'concurrent' | 'non-concurrent',
						}))
					}
					value={
						overrides.runMode ??
						(runModeResolved as 'concurrent' | 'non-concurrent')
					}
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
							id='run-mode-non-concurrent'
							value='non-concurrent'
						/>
						<label className='cursor-pointer' htmlFor='run-mode-non-concurrent'>
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
						checked={overrides.autoRunAfterSetup ?? false}
						onCheckedChange={(v) =>
							setOverrides((prev) => ({ ...prev, autoRunAfterSetup: v }))
						}
					/>
				}
				description="Start this repository's run script automatically after a new local workspace finishes setup."
				label='Auto-run after setup'
			/>

			<ScriptRow
				label='Archive script'
				description='Runs before a workspace is archived.'
				overrideValue={overrides.archiveScript}
				placeholder={archiveResolved || 'e.g. rm -rf node_modules'}
				source={resolved('archiveScript')?.source}
				onChange={(value) =>
					setOverrides((prev) => ({ ...prev, archiveScript: value }))
				}
			/>
		</SettingsSection>
	);
}

function ScriptRow({
	description,
	label,
	onChange,
	overrideValue,
	placeholder,
	source,
}: {
	description: string;
	label: string;
	onChange: (next: string) => void;
	overrideValue: string | undefined;
	placeholder: string;
	source: ResolvedSettingSnapshot['source'] | undefined;
}) {
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
				onChange={(e) => onChange(e.target.value)}
				placeholder={placeholder}
				value={overrideValue ?? ''}
			/>
		</SettingRow>
	);
}
