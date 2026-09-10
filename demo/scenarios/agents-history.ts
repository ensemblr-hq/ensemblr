import { defineScenario } from '../scenario.ts';
import agentsPanel from './agents-panel.ts';

/** Agents panel with its closed delegate history expanded. */
export default defineScenario({
	...agentsPanel,
	id: 'agents-history',
	interactions: [
		{
			kind: 'click',
			selector: 'section[aria-label="Closed conversations"] button',
			text: 'Closed',
		},
	],
	label: 'Agents — closed history',
	subAgents: agentsPanel.subAgents.map((chat, index) => ({
		...chat,
		closedAt: `2026-09-04T11:0${index + 5}:00.000Z`,
		isStreaming: false,
		currentTools: [],
	})),
});
