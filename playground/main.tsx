import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { TooltipProvider } from '@/renderer/components/ui/tooltip';
import '@/renderer/styles/index.css';

import {
	resolveFixtureAgentProviderExecutablePath,
	resolveFixtureAgentProviderMcpServers,
	resolveFixtureAgentProviderReadiness,
	resolveFixtureOpenProviderSettingsFile,
	resolveFixtureOpenTargets,
} from './agent-provider-fixtures.ts';
import { installPlaygroundBridge } from './bridge.ts';
import { resolveFixtureMergeConflicts } from './conflicts-fixtures.ts';
import { resolveFixtureLinearMetadata } from './linear-issue-editor-fixtures.ts';
import { Playground } from './playground.tsx';
import { resolveFixtureGitStatus } from './right-sidebar-header-fixtures.ts';
import {
	recordFixtureDictionaryWord,
	recordFixtureMisspellingReplacement,
	recordFixtureTextEditCommand,
	registerFixtureTextContextMenu,
} from './text-context-menu-fixtures.ts';

const rootElement = document.getElementById('root');

if (!rootElement) {
	throw new Error('Ensemblr playground root element was not found.');
}

installPlaygroundBridge({
	addWordToDictionary: recordFixtureDictionaryWord,
	getAgentProviderExecutablePath: resolveFixtureAgentProviderExecutablePath,
	getAgentProviderReadiness: resolveFixtureAgentProviderReadiness,
	getWorkspaceGitStatus: resolveFixtureGitStatus,
	getWorkspaceMergeConflicts: resolveFixtureMergeConflicts,
	linearMetadata: resolveFixtureLinearMetadata,
	listAgentProviderMcpServers: resolveFixtureAgentProviderMcpServers,
	listWorkspaceOpenTargets: resolveFixtureOpenTargets,
	onTextContextMenu: registerFixtureTextContextMenu,
	openAgentProviderSettingsFile: resolveFixtureOpenProviderSettingsFile,
	replaceMisspelling: recordFixtureMisspellingReplacement,
	runTextEditCommand: recordFixtureTextEditCommand,
});

const queryClient = new QueryClient({
	defaultOptions: {
		queries: { retry: false, staleTime: Number.POSITIVE_INFINITY },
	},
});

createRoot(rootElement).render(
	<StrictMode>
		<QueryClientProvider client={queryClient}>
			<TooltipProvider>
				<Playground />
			</TooltipProvider>
		</QueryClientProvider>
	</StrictMode>,
);
