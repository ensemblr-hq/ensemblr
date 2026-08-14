import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';

import { Button } from '@/renderer/components/ui/button';
import { Spinner } from '@/renderer/components/ui/spinner';
import type { LinearConnectionSnapshot } from '@/shared/ipc/contracts/linear';

/** Connect, disconnect, and cancel controls whose buttons reflect the current Linear connection state. */
export function LinearConnectionControls({
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
