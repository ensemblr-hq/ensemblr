import { useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCwIcon } from 'lucide-react';
import { useState } from 'react';

import {
	agentProviderReadinessQuery,
	ensemblrQueryKeys,
	selectAgentProviderExecutable,
} from '@/renderer/api/ensemblr';
import { ProviderTabPanel } from '@/renderer/components/settings/agent-providers/provider-tab-panel';
import { SettingsSection } from '@/renderer/components/settings/settings-section';
import { Button } from '@/renderer/components/ui/button';
import {
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from '@/renderer/components/ui/tabs';
import { cn } from '@/renderer/lib/utils';
import {
	type AgentProviderDescriptor,
	type AgentProviderId,
	listAgentProviderDescriptors,
} from '@/shared/agent-provider';
import type { SetupRemediationAction } from '@/shared/ipc/contracts/setup';

/**
 * Runtime the Providers page opens on. Claude Code leads the tab strip; every
 * other registered runtime follows in registry order, so a third provider shows
 * up without touching this file.
 */
const LEAD_PROVIDER: AgentProviderId = 'claude';

/**
 * Providers settings page. Claude Code and Pi are true siblings here: one
 * {@link ProviderTabPanel} renders both tabs from `(descriptor, readiness)`,
 * and the section-level Refresh re-probes whichever tab is open. Terminal
 * harnesses (Codex, Vibe) are not agent providers and never appear.
 */
export function AgentProvidersSection() {
	const queryClient = useQueryClient();
	const descriptors = orderedProviderTabs();
	const [activeProvider, setActiveProvider] = useState<AgentProviderId>(
		descriptors[0]?.id ?? LEAD_PROVIDER,
	);
	const [isManualRetrying, setIsManualRetrying] = useState(false);

	const {
		data: readiness,
		error,
		isLoading,
	} = useQuery(agentProviderReadinessQuery(activeProvider));

	const refreshActiveProvider = async () => {
		setIsManualRetrying(true);
		try {
			await queryClient.refetchQueries({
				queryKey: ensemblrQueryKeys.agentProviderReadiness(activeProvider),
			});
		} finally {
			setIsManualRetrying(false);
		}
	};

	const handleRemediation = async (action: SetupRemediationAction) => {
		if (action.kind === 'retry') {
			await refreshActiveProvider();
			return;
		}
		if (action.kind === 'open-external' && action.target) {
			await openExternalTarget(action.target);
			return;
		}
		if (action.kind === 'select-path') {
			await selectAgentProviderExecutable(activeProvider);
			await refreshActiveProvider();
		}
	};

	return (
		<SettingsSection
			action={
				<Button
					disabled={isManualRetrying}
					onClick={() => void refreshActiveProvider()}
					size='sm'
					variant='secondary'
				>
					<RefreshCwIcon
						aria-hidden='true'
						className={cn('size-4', isManualRetrying && 'animate-spin')}
					/>
					{isManualRetrying ? 'Refreshing…' : 'Refresh'}
				</Button>
			}
			description='Agent runtimes that can drive a chat. Each one resolves its own executable, reports its own readiness, and keeps its own credentials.'
			title='Providers'
		>
			<Tabs
				onValueChange={(next) => setActiveProvider(next as AgentProviderId)}
				value={activeProvider}
			>
				<TabsList aria-label='Agent providers' variant='line'>
					{descriptors.map((descriptor) => (
						<TabsTrigger key={descriptor.id} value={descriptor.id}>
							{descriptor.label}
						</TabsTrigger>
					))}
				</TabsList>
				{descriptors.map((descriptor) => (
					<TabsContent key={descriptor.id} value={descriptor.id}>
						<ProviderTabPanel
							descriptor={descriptor}
							errorMessage={error instanceof Error ? error.message : null}
							isLoading={isLoading}
							onRemediation={(action) => void handleRemediation(action)}
							readiness={readiness ?? null}
						/>
					</TabsContent>
				))}
			</Tabs>
		</SettingsSection>
	);
}

/**
 * Tab order for the page: {@link LEAD_PROVIDER} first, then the registry's own
 * order for everything else.
 * @returns The provider descriptors in tab-strip order.
 */
function orderedProviderTabs(): readonly AgentProviderDescriptor[] {
	const descriptors = listAgentProviderDescriptors();
	return [
		...descriptors.filter((descriptor) => descriptor.id === LEAD_PROVIDER),
		...descriptors.filter((descriptor) => descriptor.id !== LEAD_PROVIDER),
	];
}

/**
 * Opens a vetted documentation URL in the user's browser, degrading to a logged
 * error when the preload bridge is absent.
 * @param target - Absolute URL carried by the remediation.
 */
async function openExternalTarget(target: string): Promise<void> {
	try {
		await window.ensemblr?.openExternal(target);
	} catch (openError) {
		console.error('Failed to open external URL:', openError);
	}
}
