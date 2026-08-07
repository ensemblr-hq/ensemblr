import { CopyCommandButton } from '@/renderer/components/settings/agent-providers/copy-command-button';
import { ProviderAccountList } from '@/renderer/components/settings/agent-providers/provider-account-list';
import { ProviderCheckRow } from '@/renderer/components/settings/agent-providers/provider-check-row';
import { ProviderExecutableRow } from '@/renderer/components/settings/agent-providers/provider-executable-row';
import { ProviderSettingsFileRow } from '@/renderer/components/settings/agent-providers/provider-settings-file-row';
import { SettingRow } from '@/renderer/components/settings/setting-row';
import { StatusBadge } from '@/renderer/components/status-badge';
import { Spinner } from '@/renderer/components/ui/spinner';
import type { AgentProviderDescriptor } from '@/shared/agent-provider';
import type { AgentProviderReadinessWire } from '@/shared/ipc/contracts/agent-provider';
import type { SetupRemediationAction } from '@/shared/ipc/contracts/setup';

const EXECUTABLE_SOURCE_LABELS = {
	configured: 'a configured override',
	missing: 'nothing — no executable resolved',
	path: 'the executable found on PATH',
} satisfies Record<AgentProviderReadinessWire['executableSource'], string>;

/**
 * One agent provider's tab. Both Claude Code and Pi render through this single
 * component from `(descriptor, readiness)` — the tabs are siblings, not two
 * hand-written pages, so a change to the layout lands on both at once.
 */
export function ProviderTabPanel({
	descriptor,
	errorMessage,
	isLoading,
	onRemediation,
	readiness,
}: {
	descriptor: AgentProviderDescriptor;
	errorMessage: string | null;
	isLoading: boolean;
	onRemediation: (action: SetupRemediationAction) => void;
	readiness: AgentProviderReadinessWire | null;
}) {
	const connected = readiness?.status === 'success';

	return (
		<div className='divide-y divide-border'>
			<SettingRow
				control={
					descriptor.loginCommand && !connected ? (
						<CopyCommandButton
							command={descriptor.loginCommand}
							label={`Copy ${descriptor.loginCommand}`}
						/>
					) : null
				}
				description={describeProviderRuntime(descriptor, readiness, isLoading)}
				label={
					<span className='flex items-center gap-2'>
						{descriptor.label}
						<StatusBadge tone={statusTone(readiness, isLoading)}>
							{statusLabel(readiness, isLoading)}
						</StatusBadge>
					</span>
				}
			>
				{errorMessage ? (
					<p className='text-status-danger text-xs'>{errorMessage}</p>
				) : null}
				{descriptor.loginCommand && !connected ? (
					<p className='text-muted-foreground text-xs'>
						Sign-in is interactive: Ensemblr copies the command, you run it in a
						terminal.
					</p>
				) : null}
			</SettingRow>

			{isLoading && !readiness ? (
				<div className='flex items-center gap-2 py-6 text-muted-foreground text-sm'>
					<Spinner className='size-4' /> Checking {descriptor.label}…
				</div>
			) : null}

			{readiness?.account ? (
				<SettingRow
					description='Reported by the provider for the credentials Ensemblr will use.'
					label='Account'
					stack
				>
					<div className='mt-2'>
						<ProviderAccountList account={readiness.account} />
					</div>
				</SettingRow>
			) : null}

			{readiness && readiness.checks.length > 0 ? (
				<SettingRow
					description='Everything Ensemblr probes before it will start a chat on this runtime.'
					label='Readiness checks'
					stack
				>
					<ul className='mt-2 divide-y divide-border rounded-md border bg-card/40'>
						{readiness.checks.map((check) => (
							<ProviderCheckRow
								check={check}
								key={check.id}
								onRemediation={onRemediation}
							/>
						))}
					</ul>
				</SettingRow>
			) : null}

			<ProviderExecutableRow descriptor={descriptor} />

			{descriptor.settingsFile ? (
				<ProviderSettingsFileRow
					descriptor={descriptor}
					settingsFile={descriptor.settingsFile}
				/>
			) : null}
		</div>
	);
}

/**
 * Tone for the provider's headline badge.
 * @param readiness - Latest readiness snapshot, or null while unavailable.
 * @param isLoading - Whether the readiness probe is still in flight.
 * @returns The status tone the badge renders with.
 */
function statusTone(
	readiness: AgentProviderReadinessWire | null,
	isLoading: boolean,
): 'danger' | 'muted' | 'ok' {
	if (readiness) {
		return readiness.status === 'success' ? 'ok' : 'danger';
	}
	return isLoading ? 'muted' : 'danger';
}

/**
 * Text for the provider's headline badge.
 * @param readiness - Latest readiness snapshot, or null while unavailable.
 * @param isLoading - Whether the readiness probe is still in flight.
 * @returns The badge label.
 */
function statusLabel(
	readiness: AgentProviderReadinessWire | null,
	isLoading: boolean,
): string {
	if (readiness) {
		return readiness.status === 'success' ? 'Connected' : 'Not ready';
	}
	return isLoading ? 'Checking…' : 'Unavailable';
}

/**
 * Sentence describing the resolved runtime under the provider's headline row.
 * @param descriptor - Static facts about the provider.
 * @param readiness - Latest readiness snapshot, or null while unavailable.
 * @param isLoading - Whether the readiness probe is still in flight.
 * @returns A human-readable summary of version and executable resolution.
 */
function describeProviderRuntime(
	descriptor: AgentProviderDescriptor,
	readiness: AgentProviderReadinessWire | null,
	isLoading: boolean,
): string {
	if (!readiness) {
		return isLoading
			? `Probing the ${descriptor.executableCommand} executable…`
			: `Ensemblr could not probe the ${descriptor.executableCommand} executable.`;
	}

	const version = readiness.version
		? `${descriptor.label} ${readiness.version}`
		: descriptor.label;
	const origin = EXECUTABLE_SOURCE_LABELS[readiness.executableSource];
	const location = readiness.executablePath
		? ` at ${readiness.executablePath}`
		: '';

	return `${version}, running from ${origin}${location}.`;
}
