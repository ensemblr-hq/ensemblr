import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
import { LinearConnectionControls } from '@/renderer/components/settings/integrations/linear-connection-controls';
import { LinearConnectionStateBadge } from '@/renderer/components/settings/integrations/linear-connection-state-badge';
import { SettingRow } from '@/renderer/components/settings/setting-row';
import { LinearLogo } from '@/renderer/components/workbench-shell/source-provider-logo';
import type { LinearConnectionSnapshot } from '@/shared/ipc/contracts/linear';

/** Settings row that connects, disconnects, or reconnects the Linear integration and surfaces login failures. */
export function LinearConnectionRow() {
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
