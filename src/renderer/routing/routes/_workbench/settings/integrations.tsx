import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import type { TFunction } from 'i18next';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
	cancelLinearLogin,
	disconnectLinear,
	ensemblrQueryKeys,
	linearConnectionQuery,
	startLinearLogin,
} from '@/renderer/api/ensemblr';
import { SettingRow } from '@/renderer/components/settings/setting-row';
import { SettingsSection } from '@/renderer/components/settings/settings-section';
import { Badge } from '@/renderer/components/ui/badge';
import { Button } from '@/renderer/components/ui/button';
import { Spinner } from '@/renderer/components/ui/spinner';
import { LinearLogo } from '@/renderer/components/workbench-shell/source-provider-logo';
import type { LinearConnectionSnapshot } from '@/shared/ipc/contracts/linear';

/** Route for the Integrations settings section; renders the integrations panel. */
export const Route = createFileRoute('/_workbench/settings/integrations')({
	component: IntegrationsSettings,
});

/** Integrations settings panel; currently exposes the Linear connection row. */
function IntegrationsSettings() {
	const { t } = useTranslation();

	return (
		<SettingsSection
			description={t(
				'settings:integrations.description',
				'Third-party services Ensemblr can sign in to on your behalf. Each one is optional and can be disconnected at any time.',
			)}
			title={t('settings:integrations.title', 'Integrations')}
		>
			<LinearConnectionRow />
		</SettingsSection>
	);
}

/** Settings row that connects, disconnects, or reconnects the Linear integration and surfaces login failures. */
function LinearConnectionRow() {
	const { t } = useTranslation();
	const queryClient = useQueryClient();
	const { data: snapshot, isLoading: connectionLoading } = useQuery(
		linearConnectionQuery,
	);
	const [failureMessage, setFailureMessage] = useState<string | null>(null);

	const login = useMutation({
		mutationFn: startLinearLogin,
		onSettled: async (result) => {
			setFailureMessage(
				result?.status === 'error' ? result.failure.message : null,
			);
			await queryClient.invalidateQueries({
				queryKey: ensemblrQueryKeys.linearConnection(),
			});
		},
		onSuccess: () =>
			queryClient.invalidateQueries({
				queryKey: ensemblrQueryKeys.linearConnection(),
			}),
	});

	const disconnect = useMutation({
		mutationFn: disconnectLinear,
		onSettled: async (result) => {
			setFailureMessage(
				result?.status === 'error' ? result.failure.message : null,
			);
			await queryClient.invalidateQueries({
				queryKey: ensemblrQueryKeys.linearConnection(),
			});
		},
		onSuccess: () =>
			queryClient.invalidateQueries({
				queryKey: ensemblrQueryKeys.linearConnection(),
			}),
	});

	const cancel = useMutation({
		mutationFn: cancelLinearLogin,
		onSettled: () =>
			queryClient.invalidateQueries({
				queryKey: ensemblrQueryKeys.linearConnection(),
			}),
		onSuccess: () =>
			queryClient.invalidateQueries({
				queryKey: ensemblrQueryKeys.linearConnection(),
			}),
	});

	return (
		<SettingRow
			control={
				<LinearConnectionControls
					isDisconnecting={disconnect.isPending}
					isLoggingIn={login.isPending}
					onCancel={() => cancel.mutate()}
					onConnect={() => login.mutate()}
					onDisconnect={() => disconnect.mutate()}
					snapshot={snapshot}
				/>
			}
			description={describeLinearConnection(t, snapshot, connectionLoading)}
			label={
				/* i18next-instrument-ignore */
				<span className='flex items-center gap-2'>
					<LinearLogo className='size-4' />
					Linear
					<LinearConnectionStateBadge snapshot={snapshot} />
				</span>
			}
		>
			{failureMessage ? (
				<p className='text-status-danger text-xs'>{failureMessage}</p>
			) : null}
		</SettingRow>
	);
}

/** Connect, disconnect, and cancel controls whose buttons reflect the current Linear connection state. */
function LinearConnectionControls({
	isDisconnecting,
	isLoggingIn,
	onCancel,
	onConnect,
	onDisconnect,
	snapshot,
}: {
	isDisconnecting: boolean;
	isLoggingIn: boolean;
	onCancel: () => void;
	onConnect: () => void;
	onDisconnect: () => void;
	snapshot: LinearConnectionSnapshot | undefined;
}) {
	const { t } = useTranslation();

	if (!snapshot) {
		return <Spinner className='size-4' />;
	}

	if (isLoggingIn) {
		return (
			<div className='flex items-center gap-2'>
				<Spinner className='size-4' />
				<span className='text-muted-foreground text-xs'>
					{t('settings:integrations.linear.waiting', 'Waiting for browser…')}
				</span>
				<Button onClick={onCancel} size='sm' variant='ghost'>
					{t('common:actions.cancel', 'Cancel')}
				</Button>
			</div>
		);
	}

	if (snapshot.state === 'connected') {
		return (
			<div className='flex items-center gap-2'>
				<Button asChild size='sm' variant='ghost'>
					<Link to='/linear'>
						{t('settings:integrations.linear.browse-issues', 'Browse issues')}
					</Link>
				</Button>
				<Button
					disabled={isDisconnecting}
					onClick={onDisconnect}
					size='sm'
					variant='outline'
				>
					{isDisconnecting
						? t('settings:integrations.linear.disconnecting', 'Disconnecting…')
						: t('settings:integrations.linear.disconnect', 'Disconnect')}
				</Button>
			</div>
		);
	}

	return (
		<Button
			disabled={snapshot.state === 'not-configured'}
			onClick={onConnect}
			size='sm'
		>
			{snapshot.state === 'reconnect-required'
				? t('settings:integrations.linear.reconnect', 'Reconnect')
				: t('settings:integrations.linear.connect', 'Connect')}
		</Button>
	);
}

/** Badge showing the Linear connection state, or nothing while the snapshot is loading. */
function LinearConnectionStateBadge({
	snapshot,
}: {
	snapshot: LinearConnectionSnapshot | undefined;
}) {
	const { t } = useTranslation();

	if (!snapshot) {
		return null;
	}

	switch (snapshot.state) {
		case 'connected':
			return (
				<Badge variant='secondary'>
					{t('settings:integrations.linear.state-connected', 'Connected')}
				</Badge>
			);
		case 'reconnect-required':
			return (
				<Badge variant='destructive'>
					{t(
						'settings:integrations.linear.state-reconnect',
						'Reconnect required',
					)}
				</Badge>
			);
		case 'not-configured':
			return (
				<Badge variant='outline'>
					{t(
						'settings:integrations.linear.state-not-configured',
						'Not configured',
					)}
				</Badge>
			);
		default:
			return (
				<Badge variant='outline'>
					{t('settings:integrations.linear.state-disconnected', 'Disconnected')}
				</Badge>
			);
	}
}

/**
 * Build the human-readable description of the current Linear connection for the settings row.
 * @param t - Translation function from `useTranslation`
 * @param snapshot - Latest Linear connection snapshot, or undefined while loading
 * @param isLoading - Whether the connection query is still in flight
 * @returns A sentence describing the connection state and next action
 */
function describeLinearConnection(
	t: TFunction,
	snapshot: LinearConnectionSnapshot | undefined,
	isLoading: boolean,
): string {
	if (isLoading || !snapshot) {
		return t(
			'settings:integrations.linear.checking',
			'Checking the Linear connection…',
		);
	}

	switch (snapshot.state) {
		case 'connected': {
			const identity = snapshot.userName ?? snapshot.userEmail;
			const organization = snapshot.organizationName;

			if (identity && organization) {
				return t(
					'settings:integrations.linear.connected-as-in',
					'Connected as {{identity}} in {{organization}}.',
					{ identity, organization },
				);
			}

			return identity
				? t(
						'settings:integrations.linear.connected-as',
						'Connected as {{identity}}.',
						{ identity },
					)
				: t('settings:integrations.linear.connected', 'Connected to Linear.');
		}
		case 'not-configured':
			return t(
				'settings:integrations.linear.not-configured',
				'Add app.linear.clientId to ~/.config/ensemblr/config.json to enable Linear sign-in. Linear is optional for local and GitHub-only workflows.',
			);
		case 'reconnect-required':
			return t(
				'settings:integrations.linear.reconnect-required',
				'The stored Linear token expired and cannot be refreshed automatically. Reconnect to continue using Linear workflows.',
			);
		default:
			return t(
				'settings:integrations.linear.disconnected',
				'Connect Linear to browse issues, manage them from Ensemblr, and create workspaces from issues.',
			);
	}
}
