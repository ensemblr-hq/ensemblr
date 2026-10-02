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
	unexpectedLinearAuthFailure,
} from '@/renderer/api/ensemblr';
import { ConfirmDestructiveButton } from '@/renderer/components/settings/confirm-destructive-button';
import { LinearConnectionControls } from '@/renderer/components/settings/integrations/linear-connection-controls';
import { LinearConnectionStateBadge } from '@/renderer/components/settings/integrations/linear-connection-state-badge';
import { SettingRow } from '@/renderer/components/settings/setting-row';
import { LinearLogo } from '@/renderer/components/workbench-shell/source-provider-logo';
import { failureText } from '@/renderer/lib/failure-text';
import type {
	LinearAccountSnapshot,
	LinearAuthFailure,
	LinearConnectionSummary,
} from '@/shared/ipc/contracts/linear';

/**
 * Settings row listing every connected Linear account, with add, browse, and
 * per-account disconnect. Two organizations at once is the normal case — a
 * company workspace and a client's — so this is a list rather than a single
 * connect button.
 */
export function LinearConnectionRow() {
	const { t } = useTranslation();
	const queryClient = useQueryClient();
	const { data: summary, isLoading: connectionLoading } = useQuery(
		linearConnectionQuery,
	);
	const [failureMessage, setFailureMessage] = useState<string | null>(null);

	/** Refreshes the account list after a login or cancellation settles. */
	const invalidateConnection = () =>
		queryClient.invalidateQueries({
			queryKey: ensemblrQueryKeys.linearConnection(),
		});

	const login = useMutation({
		mutationFn: startLinearLogin,
		onSettled: async (result) => {
			setFailureMessage(
				result?.status === 'error' ? loginFailureText(t, result.failure) : null,
			);
			await invalidateConnection();
		},
	});

	const cancel = useMutation({
		mutationFn: cancelLinearLogin,
		onSettled: invalidateConnection,
	});

	const accounts = summary?.accounts ?? [];

	return (
		<SettingRow
			control={
				<LinearConnectionControls
					isLoggingIn={login.isPending}
					onCancel={() => cancel.mutate()}
					onConnect={() => login.mutate()}
					summary={summary}
				/>
			}
			description={describeLinearConnection(t, summary, connectionLoading)}
			label={
				/* i18next-instrument-ignore */
				<span className='flex items-center gap-2'>
					<LinearLogo className='size-4' />
					Linear
				</span>
			}
		>
			<div className='space-y-3'>
				{accounts.length > 0 ? (
					<ul className='divide-y divide-border overflow-hidden rounded-xl border border-border bg-card/40'>
						{accounts.map((account) => (
							<LinearAccountItem account={account} key={account.id} />
						))}
					</ul>
				) : null}

				{failureMessage ? (
					<p className='text-status-danger text-xs'>{failureMessage}</p>
				) : null}
			</div>
		</SettingRow>
	);
}

/**
 * One connected account, with its identity, state, the reason its stored token
 * last failed, and the disconnect action. Without the reason, an account stuck
 * on "Reconnect required" gives the user nothing to act on.
 */
function LinearAccountItem({ account }: { account: LinearAccountSnapshot }) {
	const { t } = useTranslation();
	const queryClient = useQueryClient();
	const [failureMessage, setFailureMessage] = useState<string | null>(null);

	const disconnect = useMutation({
		mutationFn: () => disconnectLinear(account.id),
		onError: (error) =>
			setFailureMessage(failureText(t, unexpectedLinearAuthFailure(error))),
		onSuccess: async (result) => {
			setFailureMessage(
				result.status === 'error' ? failureText(t, result.failure) : null,
			);
			await queryClient.invalidateQueries({
				queryKey: ensemblrQueryKeys.linearConnection(),
			});
			await queryClient.invalidateQueries({
				queryKey: ensemblrQueryKeys.linearIssuesAll(),
			});
			await queryClient.invalidateQueries({
				queryKey: ensemblrQueryKeys.linearMetadata(),
			});
		},
	});

	const identity = account.userName ?? account.userEmail;
	const lastError = failureText(
		t,
		account.lastErrorCode ? { code: account.lastErrorCode, message: '' } : null,
	);

	return (
		<li className='px-3 py-2.5 transition-colors hover:bg-muted/30'>
			<div className='flex items-center gap-3'>
				<div className='min-w-0 flex-1 space-y-1'>
					<div className='flex min-w-0 items-center gap-2'>
						<span className='truncate font-medium text-foreground text-sm'>
							{account.organizationName ??
								t(
									'settings:integrations.linear.unnamed-organization',
									'Unnamed organization',
								)}
						</span>
						<LinearConnectionStateBadge state={account.state} />
					</div>
					{lastError ? (
						<p className='text-status-danger text-xs'>{lastError}</p>
					) : null}
					<p className='truncate font-mono text-muted-foreground text-xxs'>
						{identity ??
							t(
								'settings:integrations.linear.unknown-user',
								'Unknown Linear user',
							)}
						{account.organizationUrlKey
							? ` · ${account.organizationUrlKey}`
							: ''}
					</p>
				</div>
				{/* Disconnecting revokes the grant at Linear and drops this account's
				    cached issues, so there is no undo short of signing in again. */}
				<ConfirmDestructiveButton
					armedLabel={t(
						'settings:integrations.linear.disconnect-confirm',
						'Confirm disconnect',
					)}
					disabled={disconnect.isPending}
					label={t('settings:integrations.linear.disconnect', 'Disconnect')}
					onConfirm={() => disconnect.mutate()}
					size='xs'
				/>
			</div>
			{failureMessage ? (
				<p className='pt-1.5 text-status-danger text-xs'>{failureMessage}</p>
			) : null}
		</li>
	);
}

/**
 * Translate a failed login attempt, treating a cancellation as a settled outcome
 * rather than an error — the user pressed Cancel, so nothing needs reporting.
 * @param t - Translation function from `useTranslation`
 * @param failure - The failure the login attempt reported
 * @returns The message to show, or null when the user canceled
 */
function loginFailureText(t: TFunction, failure: LinearAuthFailure) {
	return failure.code === 'login-canceled' ? null : failureText(t, failure);
}

/**
 * Build the human-readable description of the current Linear connection for the settings row.
 * @param t - Translation function from `useTranslation`
 * @param summary - Latest Linear connection summary, or undefined while loading
 * @param isLoading - Whether the connection query is still in flight
 * @returns A sentence describing the connection state and next action
 */
function describeLinearConnection(
	t: TFunction,
	summary: LinearConnectionSummary | undefined,
	isLoading: boolean,
): string {
	if (isLoading || !summary) {
		return t(
			'settings:integrations.linear.checking',
			'Checking the Linear connection…',
		);
	}

	switch (summary.state) {
		case 'connected':
			return t(
				'settings:integrations.linear.connected-count',
				'{{count}} accounts connected. Their issues appear together, each tagged with its organization.',
				{
					count: summary.accounts.length,
					defaultValue_one:
						'One account connected. Add another to work across organizations.',
				},
			);
		case 'not-configured':
			return t(
				'settings:integrations.linear.not-configured',
				'Add app.linear.clientId to ~/.config/ensemblr/config.json to enable Linear sign-in. Linear is optional for local and GitHub-only workflows.',
			);
		case 'reconnect-required':
			return t(
				'settings:integrations.linear.reconnect-required',
				'Every connected Linear account has an expired token that cannot be refreshed automatically. Reconnect to continue using Linear workflows.',
			);
		default:
			return t(
				'settings:integrations.linear.disconnected',
				'Connect Linear to browse issues, manage them from Ensemblr, and create workspaces from issues. Add more than one account to work across organizations.',
			);
	}
}
