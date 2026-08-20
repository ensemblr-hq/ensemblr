import { useState } from 'react';

import { LinearIssueEditorDialog } from '@/renderer/components/linear/issue-editor-dialog';
import { LinearIssueFilterBar } from '@/renderer/components/linear/issue-list-toolbar';
import { ALL_ACCOUNTS, ALL_TEAMS } from '@/renderer/lib/linear';

import {
	createFixtureLinearIssue,
	FIXTURE_LINEAR_ACCOUNTS,
	resolveFixtureLinearMetadata,
} from './linear-issue-editor-fixtures.ts';
import {
	ControlGroup,
	SceneControls,
	SceneSection,
	SceneToggle,
} from './scene-chrome.tsx';

/**
 * The Linear issue composer without Electron. Both modes come out of the one
 * dialog, so the scene only picks whether an issue is passed in — create starts
 * with no team, which is the state that gates every team-scoped picker.
 */
export function LinearIssueEditorScene() {
	const [mode, setMode] = useState<'create' | 'edit'>('create');
	const [open, setOpen] = useState(true);
	const [accountId, setAccountId] = useState(ALL_ACCOUNTS);
	const [teamId, setTeamId] = useState(ALL_TEAMS);
	const [query, setQuery] = useState('');

	return (
		<SceneSection
			label='Linear · issue composer'
			note={`Metadata comes from ${resolveFixtureLinearMetadata().metadata.teams.length} teams across two organizations. Cycle 42 is unnamed, so the picker names it from its number.`}
		>
			<SceneControls>
				<ControlGroup label='mode'>
					<SceneToggle
						isActive={mode === 'create'}
						label='create'
						onClick={() => {
							setMode('create');
							setOpen(true);
						}}
					/>
					<SceneToggle
						isActive={mode === 'edit'}
						label='edit'
						onClick={() => {
							setMode('edit');
							setOpen(true);
						}}
					/>
				</ControlGroup>
				<ControlGroup label='dialog'>
					<SceneToggle
						isActive={open}
						label='open'
						onClick={() => setOpen(true)}
					/>
				</ControlGroup>
			</SceneControls>
			<div className='rounded-md border border-border bg-background p-3'>
				<LinearIssueFilterBar
					accountId={accountId}
					accounts={FIXTURE_LINEAR_ACCOUNTS}
					onAccountChange={setAccountId}
					onClearFilters={() => {
						setAccountId(ALL_ACCOUNTS);
						setTeamId(ALL_TEAMS);
						setQuery('');
					}}
					onNewIssue={() => {
						setMode('create');
						setOpen(true);
					}}
					onQueryChange={setQuery}
					onRefresh={() => undefined}
					onTeamChange={setTeamId}
					query={query}
					refreshing={false}
					showAccounts
					teamId={teamId}
					teams={resolveFixtureLinearMetadata().metadata.teams}
				/>
			</div>
			<LinearIssueEditorDialog
				issue={mode === 'edit' ? createFixtureLinearIssue() : undefined}
				key={mode}
				onOpenChange={setOpen}
				open={open}
			/>
		</SceneSection>
	);
}
