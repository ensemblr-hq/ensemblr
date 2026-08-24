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
import {
	registerFixtureConciergeEvents,
	resolveFixtureAgentModels,
	resolveFixtureAllChatTabs,
	resolveFixtureAppSettings,
	resolveFixtureConciergeClear,
	resolveFixtureConciergeEvents,
	resolveFixtureConciergePressure,
	resolveFixtureConciergeSession,
	resolveFixtureConciergeStop,
	resolveFixtureConciergeSubmit,
	resolveFixtureDictationKeyStatus,
} from './concierge-fixtures.ts';
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
	clearConciergeContext: resolveFixtureConciergeClear,
	conciergeContextPressure: resolveFixtureConciergePressure,
	dictationKeyStatus: resolveFixtureDictationKeyStatus,
	getAgentProviderExecutablePath: resolveFixtureAgentProviderExecutablePath,
	getAgentProviderReadiness: resolveFixtureAgentProviderReadiness,
	getAppSettings: resolveFixtureAppSettings,
	getWorkspaceGitStatus: resolveFixtureGitStatus,
	getWorkspaceMergeConflicts: resolveFixtureMergeConflicts,
	linearMetadata: resolveFixtureLinearMetadata,
	listAgentModels: resolveFixtureAgentModels,
	listAgentProviderMcpServers: resolveFixtureAgentProviderMcpServers,
	listAllChatTabs: resolveFixtureAllChatTabs,
	listConciergeEvents: resolveFixtureConciergeEvents,
	listWorkspaceOpenTargets: resolveFixtureOpenTargets,
	onConciergeSessionEvent: registerFixtureConciergeEvents,
	onTextContextMenu: registerFixtureTextContextMenu,
	openAgentProviderSettingsFile: resolveFixtureOpenProviderSettingsFile,
	openConciergeSession: resolveFixtureConciergeSession,
	replaceMisspelling: recordFixtureMisspellingReplacement,
	runTextEditCommand: recordFixtureTextEditCommand,
	stopConciergeSession: resolveFixtureConciergeStop,
	submitConciergePrompt: resolveFixtureConciergeSubmit,
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
