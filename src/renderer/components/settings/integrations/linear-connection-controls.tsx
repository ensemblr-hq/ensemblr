import { Link } from '@tanstack/react-router';
import { PlusIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/renderer/components/ui/button';
import { Spinner } from '@/renderer/components/ui/spinner';
import type { LinearConnectionSummary } from '@/shared/ipc/contracts/linear';

/**
 * Row-level Linear controls: add another account, browse the merged issue list,
 * or cancel a login already waiting on the browser. Disconnecting is per-account
 * and lives on the account itself.
 */
export function LinearConnectionControls({
	isLoggingIn,
	onCancel,
	onConnect,
	summary,
}: {
	isLoggingIn: boolean;
	onCancel: () => void;
	onConnect: () => void;
	summary: LinearConnectionSummary | undefined;
}) {
	const { t } = useTranslation();

	if (!summary) {
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

	return (
		<div className='flex items-center gap-2'>
			{summary.accounts.length > 0 ? (
				<Button asChild size='sm' variant='ghost'>
					<Link to='/linear'>
						{t('settings:integrations.linear.browse-issues', 'Browse issues')}
					</Link>
				</Button>
			) : null}
			<Button
				disabled={summary.state === 'not-configured'}
				onClick={onConnect}
				size='sm'
				type='button'
				variant='outline'
			>
				<PlusIcon aria-hidden='true' className='size-3.5' />
				{t('settings:integrations.linear.add', 'Add account')}
			</Button>
		</div>
	);
}
