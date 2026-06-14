import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';

import {
	ensembleQueryKeys,
	setupDiagnosticsQuery,
} from '@/renderer/api/ensemble';
import { SettingRow } from '@/renderer/components/settings/setting-row';
import { SettingsSection } from '@/renderer/components/settings/settings-section';
import { Badge } from '@/renderer/components/ui/badge';
import { Button } from '@/renderer/components/ui/button';
import { Spinner } from '@/renderer/components/ui/spinner';
import type { SetupCheckSnapshot, SetupCheckStatus } from '@/shared/ipc';

export const Route = createFileRoute('/_workbench/settings/providers')({
	component: ProvidersSettings,
});

/** Pi sources we surface as "providers" in the settings shell. */
const PROVIDER_GROUPS: ReadonlyArray<{
	title: string;
	description: string;
	checkIds: readonly string[];
}> = [
	{
		checkIds: ['pi-executable', 'pi-rpc', 'pi-agent-directory'],
		description:
			'Pi CLI binary, RPC channel, and the agent directory used to launch sessions.',
		title: 'Pi runtime',
	},
	{
		checkIds: ['pi-provider-model'],
		description:
			'The model provider Pi is configured to use. Configure provider credentials through Pi itself; Ensemble does not store provider tokens.',
		title: 'Pi model provider',
	},
	{
		checkIds: ['gh-cli', 'gh-auth'],
		description:
			'The GitHub CLI is the v1 GitHub integration. Authenticate with `gh auth login` and Ensemble will pick it up.',
		title: 'GitHub CLI',
	},
];

function ProvidersSettings() {
	const queryClient = useQueryClient();
	const diagnostics = useQuery(setupDiagnosticsQuery);
	const checksById = new Map(
		(diagnostics.data?.checks ?? []).map((check) => [check.id, check]),
	);

	const refresh = () =>
		queryClient.invalidateQueries({
			queryKey: ensembleQueryKeys.setupDiagnostics(),
		});

	return (
		<SettingsSection
			action={
				<Button
					disabled={diagnostics.isFetching}
					onClick={() => refresh()}
					size='sm'
					variant='outline'
				>
					{diagnostics.isFetching ? 'Re-checking…' : 'Re-check'}
				</Button>
			}
			description='Pi runtime, model provider, and GitHub readiness sourced from the setup-diagnostics gate. Resolve blocked checks in Diagnostics.'
			title='Providers'
		>
			{diagnostics.isLoading ? (
				<div className='flex items-center gap-2 py-6 text-muted-foreground text-sm'>
					<Spinner className='size-4' /> Reading provider readiness…
				</div>
			) : null}

			{PROVIDER_GROUPS.map((group) => {
				const checks = group.checkIds
					.map((id) => checksById.get(id as SetupCheckSnapshot['id']))
					.filter((check): check is SetupCheckSnapshot => Boolean(check));
				return (
					<SettingRow
						control={<ProviderStatusBadge checks={checks} />}
						description={group.description}
						key={group.title}
						label={group.title}
						stack
					>
						{checks.length === 0 ? (
							<p className='mt-2 text-muted-foreground text-xs'>
								No diagnostic checks reported for this group yet.
							</p>
						) : (
							<ul className='mt-2 space-y-1.5'>
								{checks.map((check) => (
									<li className='flex items-start gap-3 text-xs' key={check.id}>
										<CheckStatusDot status={check.status} />
										<div className='min-w-0 flex-1'>
											<div className='font-medium text-foreground'>
												{check.title}
											</div>
											<p className='text-muted-foreground leading-snug'>
												{check.detail || check.description}
											</p>
										</div>
									</li>
								))}
							</ul>
						)}
					</SettingRow>
				);
			})}

			<SettingRow
				control={
					<Button asChild size='sm' variant='ghost'>
						<Link to='/settings/diagnostics'>Open Diagnostics</Link>
					</Button>
				}
				description='Full setup gate with remediation actions for every blocked check.'
				label='Diagnose providers'
			/>
		</SettingsSection>
	);
}

function ProviderStatusBadge({ checks }: { checks: SetupCheckSnapshot[] }) {
	if (checks.length === 0) {
		return <Badge variant='outline'>Unknown</Badge>;
	}
	const worst = worstStatus(checks.map((c) => c.status));
	switch (worst) {
		case 'success':
			return <Badge variant='secondary'>Ready</Badge>;
		case 'warning':
			return <Badge variant='outline'>Warnings</Badge>;
		case 'running':
			return <Badge variant='outline'>Checking…</Badge>;
		case 'failure':
			return <Badge variant='destructive'>Blocked</Badge>;
		default:
			return <Badge variant='outline'>Pending</Badge>;
	}
}

function CheckStatusDot({ status }: { status: SetupCheckStatus }) {
	const tone = (() => {
		switch (status) {
			case 'success':
				return 'bg-status-success';
			case 'warning':
				return 'bg-status-warning';
			case 'failure':
				return 'bg-status-danger';
			default:
				return 'bg-muted-foreground';
		}
	})();
	return (
		<span
			aria-hidden='true'
			className={`mt-1.5 inline-block size-1.5 shrink-0 rounded-full ${tone}`}
		/>
	);
}

const STATUS_RANK: Record<SetupCheckStatus, number> = {
	failure: 4,
	warning: 3,
	running: 2,
	pending: 1,
	success: 0,
};

function worstStatus(statuses: SetupCheckStatus[]): SetupCheckStatus {
	let worst: SetupCheckStatus = 'success';
	for (const status of statuses) {
		if (STATUS_RANK[status] > STATUS_RANK[worst]) {
			worst = status;
		}
	}
	return worst;
}
