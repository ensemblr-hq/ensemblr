import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';

import {
	ensembleQueryKeys,
	setupDiagnosticsQuery,
} from '@/renderer/api/ensemble-queries';
import { SetupDiagnosticsPanel } from '@/renderer/components/setup-diagnostics';

export const Route = createFileRoute('/_workbench/settings/diagnostics')({
	component: DiagnosticsRoute,
});

/**
 * Settings → Diagnostics. Renders the full setup gate so the user can resolve
 * blocked checks without leaving the workbench. Queries the IPC directly so
 * this route does not depend on the workbench-shell SetupDiagnosticsProvider
 * (settings render outside that shell).
 */
function DiagnosticsRoute() {
	const queryClient = useQueryClient();
	const query = useQuery(setupDiagnosticsQuery);
	const [isRetrying, setIsRetrying] = useState(false);

	const onRetry = async () => {
		setIsRetrying(true);
		try {
			await queryClient.invalidateQueries({
				queryKey: ensembleQueryKeys.setupDiagnostics(),
			});
		} finally {
			setIsRetrying(false);
		}
	};

	return (
		<div className='flex flex-col gap-4 p-4'>
			<header className='flex flex-col gap-1'>
				<h1 className='font-semibold text-foreground text-lg'>Diagnostics</h1>
				<p className='text-muted-foreground text-sm'>
					Setup gate checks for Pi, git, GitHub, Linear, and the Ensemble
					runtime. Resolve blocked checks here; the workbench will re-enable
					the composer automatically.
				</p>
			</header>
			<SetupDiagnosticsPanel
				error={query.error instanceof Error ? query.error.message : null}
				isRetrying={isRetrying || query.isFetching}
				onRetry={onRetry}
				snapshot={query.data ?? null}
			/>
		</div>
	);
}
