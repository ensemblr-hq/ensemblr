import { useState } from 'react';

import { LinearIssueProperties } from '@/renderer/components/linear/issue-properties';
import type { LinearIssueWire } from '@/shared/ipc/contracts/linear';

import { createFixtureLinearIssue } from './linear-issue-editor-fixtures.ts';
import {
	ControlGroup,
	SceneControls,
	SceneSection,
	SceneToggle,
} from './scene-chrome.tsx';

/** Strip the optional rows so the sparse rail is one toggle away from the full one. */
function emptyFixtureIssue(issue: LinearIssueWire): LinearIssueWire {
	return {
		...issue,
		assigneeId: null,
		assigneeName: null,
		cycleId: null,
		cycleName: null,
		dueDate: null,
		labels: [],
		projectId: null,
		projectName: null,
	};
}

/**
 * The issue page's property rail at its real 15rem width, without Electron. The
 * pickers read their options from the metadata query, which the playground
 * bridge already answers from the same fixtures the editor scene uses.
 */
export function LinearIssuePropertiesScene() {
	const [sparse, setSparse] = useState(false);
	const issue = createFixtureLinearIssue();

	return (
		<SceneSection
			label='Linear · issue properties'
			note='The rail is 15rem in the issue page, so the scene pins it there. Its label column sizes itself to the longest label rather than to a fixed width, which is what keeps the longer Russian and Greek words from wrapping.'
		>
			<SceneControls>
				<ControlGroup label='issue'>
					<SceneToggle
						isActive={!sparse}
						label='filled'
						onClick={() => setSparse(false)}
					/>
					<SceneToggle
						isActive={sparse}
						label='sparse'
						onClick={() => setSparse(true)}
					/>
				</ControlGroup>
			</SceneControls>
			<div className='w-60 rounded-md border border-border bg-background p-3'>
				<LinearIssueProperties
					issue={sparse ? emptyFixtureIssue(issue) : issue}
				/>
			</div>
		</SceneSection>
	);
}
