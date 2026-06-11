import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useState } from 'react';

import {
	cancelLinearLogin,
	disconnectLinear,
	ensembleQueryKeys,
	linearConnectionQuery,
	startLinearLogin,
} from '@/renderer/api/ensemble';
import { SettingRow } from '@/renderer/components/settings/setting-row';
import { SettingsSection } from '@/renderer/components/settings/settings-section';
import { Badge } from '@/renderer/components/ui/badge';
import { Button } from '@/renderer/components/ui/button';
import { Spinner } from '@/renderer/components/ui/spinner';
import { LinearLogo } from '@/renderer/components/workbench-shell/source-provider-logo';
import type { LinearConnectionSnapshot } from '@/shared/ipc';

export const Route = createFileRoute('/_workbench/settings/integrations')({
	component: IntegrationsSettings,
});

function IntegrationsSettings() {
	return (
		<SettingsSection title='Integrations'>
			<LinearConnectionRow />
		</SettingsSection>
	);
}

function LinearConnectionRow() {
	const queryClient = useQueryClient();
	const connection = useQuery(linearConnectionQuery);
	const [failureMessage, setFailureMessage] = useState<string | null>(null);

	const invalidateConnection = () =>
		queryClient.invalidateQueries({
			queryKey: ensembleQueryKeys.linearConnection(),
		});

	const login = useMutation({
		mutationFn: startLinearLogin,
		onSettled: async (result) => {
			setFailureMessage(
				result?.status === 'error' ? result.failure.message : null,
			);
			await invalidateConnection();
		},
	});

	const disconnect = useMutation({
		mutationFn: disconnectLinear,
		onSettled: async (result) => {
			setFailureMessage(
				result?.status === 'error' ? result.failure.message : null,
			);
			await invalidateConnection();
		},
	});

	const cancel = useMutation({
		mutationFn: cancelLinearLogin,
		onSettled: () => invalidateConnection(),
	});

	const snapshot = connection.data;

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
			description={describeLinearConnection(snapshot, connection.isLoading)}
			label={
				<span className='flex items-center gap-2'>
					<LinearLogo className='size-4' />
					Linear
					<LinearStateBadge snapshot={snapshot} />
				</span>
			}
		>
			{failureMessage ? (
				<p className='text-status-danger text-xs'>{failureMessage}</p>
			) : null}
		</SettingRow>
	);
}

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
	if (!snapshot) {
		return <Spinner className='size-4' />;
	}

	if (isLoggingIn) {
		return (
			<div className='flex items-center gap-2'>
				<Spinner className='size-4' />
				<span className='text-muted-foreground text-xs'>
					Waiting for browser…
				</span>
				<Button onClick={onCancel} size='sm' variant='ghost'>
					Cancel
				</Button>
			</div>
		);
	}

	if (snapshot.state === 'connected') {
		return (
			<div className='flex items-center gap-2'>
				<Button asChild size='sm' variant='ghost'>
					<Link to='/linear'>Browse issues</Link>
				</Button>
				<Button
					disabled={isDisconnecting}
					onClick={onDisconnect}
					size='sm'
					variant='outline'
				>
					{isDisconnecting ? 'Disconnecting…' : 'Disconnect'}
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
			{snapshot.state === 'reconnect-required' ? 'Reconnect' : 'Connect'}
		</Button>
	);
}

function LinearStateBadge({
	snapshot,
}: {
	snapshot: LinearConnectionSnapshot | undefined;
}) {
	if (!snapshot) {
		return null;
	}

	switch (snapshot.state) {
		case 'connected':
			return <Badge variant='secondary'>Connected</Badge>;
		case 'reconnect-required':
			return <Badge variant='destructive'>Reconnect required</Badge>;
		case 'not-configured':
			return <Badge variant='outline'>Not configured</Badge>;
		default:
			return <Badge variant='outline'>Disconnected</Badge>;
	}
}

function describeLinearConnection(
	snapshot: LinearConnectionSnapshot | undefined,
	isLoading: boolean,
): string {
	if (isLoading || !snapshot) {
		return 'Checking the Linear connection…';
	}

	switch (snapshot.state) {
		case 'connected': {
			const identity = snapshot.userName ?? snapshot.userEmail;
			const organization = snapshot.organizationName;

			if (identity && organization) {
				return `Connected as ${identity} in ${organization}.`;
			}

			return identity ? `Connected as ${identity}.` : 'Connected to Linear.';
		}
		case 'not-configured':
			return 'Add app.linear.clientId to ~/.config/ensemble/config.json to enable Linear sign-in. Linear is optional for local and GitHub-only workflows.';
		case 'reconnect-required':
			return 'The stored Linear token expired and cannot be refreshed automatically. Reconnect to continue using Linear workflows.';
		default:
			return 'Connect Linear to browse issues, manage them from Ensemble, and create workspaces from issues.';
	}
}
