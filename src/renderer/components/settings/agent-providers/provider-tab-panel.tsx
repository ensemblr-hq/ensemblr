import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';

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

/**
 * Names where the runtime's executable was resolved from, for the sentence under
 * the provider headline.
 * @param t - Translation function from `useTranslation`
 * @param source - The resolution source reported by readiness
 * @returns The clause naming that source
 */
function executableSourceLabel(
	t: TFunction,
	source: AgentProviderReadinessWire['executableSource'],
): string {
	switch (source) {
		case 'configured':
			return t(
				'settings:providers.executable-source.configured',
				'a configured override',
			);
		case 'missing':
			return t(
				'settings:providers.executable-source.missing',
				'nothing — no executable resolved',
			);
		default:
			return t(
				'settings:providers.executable-source.path',
				'the executable found on PATH',
			);
	}
}

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
	const { t } = useTranslation();
	const connected = readiness?.status === 'success';

	return (
		<div className='divide-y divide-border'>
			<SettingRow
				control={
					descriptor.loginCommand && !connected ? (
						<CopyCommandButton
							command={descriptor.loginCommand}
							label={t('settings:providers.copy-command', 'Copy {{command}}', {
								command: descriptor.loginCommand,
							})}
						/>
					) : null
				}
				description={describeProviderRuntime(
					t,
					descriptor,
					readiness,
					isLoading,
				)}
				label={
					<span className='flex items-center gap-2'>
						{descriptor.label}
						<StatusBadge tone={statusTone(readiness, isLoading)}>
							{statusLabel(t, readiness, isLoading)}
						</StatusBadge>
					</span>
				}
			>
				{errorMessage ? (
					<p className='text-status-danger text-xs'>{errorMessage}</p>
				) : null}
				{descriptor.loginCommand && !connected ? (
					<p className='text-muted-foreground text-xs'>
						{t(
							'settings:providers.sign-in-hint',
							'Sign-in is interactive: Ensemblr copies the command, you run it in a terminal.',
						)}
					</p>
				) : null}
			</SettingRow>

			{isLoading && !readiness ? (
				<div className='flex items-center gap-2 py-6 text-muted-foreground text-sm'>
					<Spinner className='size-4' />{' '}
					{t('settings:providers.checking', 'Checking {{provider}}…', {
						provider: descriptor.label,
					})}
				</div>
			) : null}

			{readiness?.account ? (
				<SettingRow
					description={t(
						'settings:providers.account.description',
						'Reported by the provider for the credentials Ensemblr will use.',
					)}
					label={t('settings:providers.account.label', 'Account')}
					stack
				>
					<div className='mt-2'>
						<ProviderAccountList account={readiness.account} />
					</div>
				</SettingRow>
			) : null}

			{readiness && readiness.checks.length > 0 ? (
				<SettingRow
					description={t(
						'settings:providers.checks.description',
						'Everything Ensemblr probes before it will start a chat on this runtime.',
					)}
					label={t('settings:providers.checks.label', 'Readiness checks')}
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
 * @param t - Translation function from `useTranslation`
 * @param readiness - Latest readiness snapshot, or null while unavailable.
 * @param isLoading - Whether the readiness probe is still in flight.
 * @returns The badge label.
 */
function statusLabel(
	t: TFunction,
	readiness: AgentProviderReadinessWire | null,
	isLoading: boolean,
): string {
	if (readiness) {
		return readiness.status === 'success'
			? t('settings:providers.status.connected', 'Connected')
			: t('settings:providers.status.not-ready', 'Not ready');
	}
	return isLoading
		? t('settings:providers.status.checking', 'Checking…')
		: t('settings:providers.status.unavailable', 'Unavailable');
}

/**
 * Sentence describing the resolved runtime under the provider's headline row.
 * @param t - Translation function from `useTranslation`
 * @param descriptor - Static facts about the provider.
 * @param readiness - Latest readiness snapshot, or null while unavailable.
 * @param isLoading - Whether the readiness probe is still in flight.
 * @returns A human-readable summary of version and executable resolution.
 */
function describeProviderRuntime(
	t: TFunction,
	descriptor: AgentProviderDescriptor,
	readiness: AgentProviderReadinessWire | null,
	isLoading: boolean,
): string {
	if (!readiness) {
		return isLoading
			? t(
					'settings:providers.runtime.probing',
					'Probing the {{command}} executable…',
					{ command: descriptor.executableCommand },
				)
			: t(
					'settings:providers.runtime.probe-failed',
					'Ensemblr could not probe the {{command}} executable.',
					{ command: descriptor.executableCommand },
				);
	}

	const runtime = readiness.version
		? `${descriptor.label} ${readiness.version}`
		: descriptor.label;
	const origin = executableSourceLabel(t, readiness.executableSource);

	return readiness.executablePath
		? t(
				'settings:providers.runtime.resolved-at',
				'{{runtime}}, running from {{origin}} at {{path}}.',
				{ origin, path: readiness.executablePath, runtime },
			)
		: t(
				'settings:providers.runtime.resolved',
				'{{runtime}}, running from {{origin}}.',
				{ origin, runtime },
			);
}
