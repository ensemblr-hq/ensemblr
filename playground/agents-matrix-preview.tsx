import { useState } from 'react';

import type {
	AgentConversationStatus,
	AgentsPanelState,
} from '@/renderer/types/agents';
import {
	type AgentFixtureContext,
	type AgentFixtureDensity,
	type AgentFixtureTool,
	createAgentConversations,
} from './agents-fixtures.ts';
import { AgentsSidebarPreview } from './agents-sidebar-preview.tsx';
import {
	ControlGroup,
	SceneControls,
	SceneLanguageControl,
	SceneToggle,
} from './scene-chrome.tsx';

/** Component/state matrix for hierarchy, status, context, activity, and failures. */
export function AgentsMatrixScene() {
	const [status, setStatus] = useState<AgentConversationStatus>('working');
	const [context, setContext] = useState<AgentFixtureContext>('live');
	const [tool, setTool] = useState<AgentFixtureTool>('parallel');
	const [density, setDensity] = useState<AgentFixtureDensity>('default');
	const [panelState, setPanelState] = useState<AgentsPanelState>('ready');
	const [selectedId, setSelectedId] = useState('child-fixtures');
	const [restoredIds, setRestoredIds] = useState<ReadonlySet<string>>(
		new Set(),
	);
	const conversations = createAgentConversations({
		context,
		density,
		status,
		tool,
	}).map((conversation) =>
		restoredIds.has(conversation.chatTabId)
			? { ...conversation, isClosed: false }
			: conversation,
	);
	const reset = () => {
		setStatus('working');
		setContext('live');
		setTool('parallel');
		setDensity('default');
		setPanelState('ready');
		setSelectedId('child-fixtures');
		setRestoredIds(new Set());
	};

	return (
		<>
			<SceneControls>
				<ControlGroup label='status'>
					{(['idle', 'working', 'blocked'] as const).map((value) => (
						<SceneToggle
							isActive={status === value}
							key={value}
							label={value}
							onClick={() => setStatus(value)}
						/>
					))}
				</ControlGroup>
				<ControlGroup label='context'>
					{(['unavailable', 'live', 'last-recorded'] as const).map((value) => (
						<SceneToggle
							isActive={context === value}
							key={value}
							label={value}
							onClick={() => setContext(value)}
						/>
					))}
				</ControlGroup>
				<ControlGroup label='tools'>
					{(['none', 'single', 'parallel', 'long'] as const).map((value) => (
						<SceneToggle
							isActive={tool === value}
							key={value}
							label={value}
							onClick={() => setTool(value)}
						/>
					))}
				</ControlGroup>
				<ControlGroup label='content'>
					{(['default', 'crowded', 'empty'] as const).map((value) => (
						<SceneToggle
							isActive={density === value}
							key={value}
							label={value}
							onClick={() => setDensity(value)}
						/>
					))}
				</ControlGroup>
				<ControlGroup label='panel'>
					{(['ready', 'loading', 'error'] as const).map((value) => (
						<SceneToggle
							isActive={panelState === value}
							key={value}
							label={value}
							onClick={() => setPanelState(value)}
						/>
					))}
				</ControlGroup>
				<SceneLanguageControl />
				<ControlGroup label='fixture'>
					<SceneToggle isActive={false} label='reset' onClick={reset} />
				</ControlGroup>
			</SceneControls>
			<div className='mx-auto h-160 w-full max-w-md overflow-hidden rounded-lg border border-border bg-background shadow-panel'>
				<AgentsSidebarPreview
					conversations={conversations}
					onRestore={(id) => {
						setRestoredIds((current) => new Set([...current, id]));
						setSelectedId(id);
					}}
					onRetry={() => setPanelState('ready')}
					onSelect={setSelectedId}
					selectedChatTabId={selectedId}
					state={panelState}
				/>
			</div>
		</>
	);
}
