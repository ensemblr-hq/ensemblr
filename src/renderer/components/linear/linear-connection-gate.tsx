import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';

import { linearConnectionQuery } from '@/renderer/api/ensemble';
import { Button } from '@/renderer/components/ui/button';
import { Spinner } from '@/renderer/components/ui/spinner';
import { LinearLogo } from '@/renderer/components/workbench-shell/source-provider-logo';
import { deriveLinearGateState } from '@/renderer/lib/linear';

/**
 * Gates Linear surfaces on the connection state: renders children when
 * connected, otherwise shows sign-in / configuration remediation.
 */
export function LinearConnectionGate({ children }: { children: ReactNode }) {
	const { data: connectionData, isLoading: connectionLoading } = useQuery(
		linearConnectionQuery,
	);
	const gate = deriveLinearGateState({
		connection: connectionData,
		isLoading: connectionLoading,
	});

	if (gate.kind === 'ready') {
		return <>{children}</>;
	}

	if (gate.kind === 'loading') {
		return (
			<div className='flex flex-1 items-center justify-center py-16'>
				<Spinner className='size-5' />
			</div>
		);
	}

	return (
		<div className='flex flex-1 flex-col items-center justify-center gap-3 py-16 text-center'>
			<LinearLogo className='size-8 text-muted-foreground' />
			<p className='font-medium text-foreground text-sm'>
				{gate.kind === 'not-configured'
					? 'Linear is not configured'
					: gate.kind === 'reconnect-required'
						? 'Linear needs to be reconnected'
						: 'Linear is not connected'}
			</p>
			<p className='max-w-sm text-muted-foreground text-xs leading-relaxed'>
				{gate.kind === 'not-configured'
					? 'Add app.linear.clientId to ~/.config/ensemble/config.json, then connect from integration settings.'
					: 'Connect Linear from integration settings to browse issues, manage them from Ensemble, and create workspaces from issues.'}
			</p>
			<Button asChild size='sm' variant='outline'>
				<Link to='/settings/integrations'>Open integration settings</Link>
			</Button>
		</div>
	);
}
