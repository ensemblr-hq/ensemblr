import type { DemoScenario } from '../scenario.ts';
import board from './board.ts';
import boardCardMenu from './board-card-menu.ts';
import checksPullRequest from './checks-pull-request.ts';
import concierge from './concierge.ts';
import createWorkspaceBranches from './create-workspace-branches.ts';
import createWorkspaceSources from './create-workspace-sources.ts';
import dockRunPicker from './dock-run-picker.ts';
import dockTerminal from './dock-terminal.ts';
import heroOrchestrator from './hero-orchestrator.ts';
import linearIssues from './linear-issues.ts';
import onboardingAgentCli from './onboarding-agent-cli.ts';
import onboardingWelcome from './onboarding-welcome.ts';
import planMode from './plan-mode.ts';
import reviewChanges from './review-changes.ts';
import settingsDiagnostics from './settings-diagnostics.ts';
import settingsGeneral from './settings-general.ts';
import settingsProviders from './settings-providers.ts';
import settingsProvidersClaude from './settings-providers-claude.ts';
import settingsShortcuts from './settings-shortcuts.ts';
import subagentFanout from './subagent-fanout.ts';
import workspaceMidTurn from './workspace-mid-turn.ts';
import workspaceMidTurnLight from './workspace-mid-turn-light.ts';

/**
 * Every scenario demo mode can apply, in the order the toolbar lists them. Add a
 * scenario file and its entry here; nothing else registers one.
 */
export const DEMO_SCENARIOS: readonly DemoScenario[] = [
	heroOrchestrator,
	workspaceMidTurn,
	workspaceMidTurnLight,
	planMode,
	subagentFanout,
	reviewChanges,
	checksPullRequest,
	dockTerminal,
	dockRunPicker,
	board,
	boardCardMenu,
	createWorkspaceSources,
	createWorkspaceBranches,
	linearIssues,
	concierge,
	onboardingWelcome,
	onboardingAgentCli,
	settingsProviders,
	settingsProvidersClaude,
	settingsGeneral,
	settingsDiagnostics,
	settingsShortcuts,
];

/**
 * Resolves a scenario by id, falling back to the first when the id names none —
 * a stale `?scenario=` in a reloaded window should still paint something.
 * @param id - Scenario id, typically from the window's query string.
 * @returns The matching scenario, or the first one registered.
 */
export function resolveScenario(id: string | null): DemoScenario {
	const match = DEMO_SCENARIOS.find((scenario) => scenario.id === id);
	if (match) {
		return match;
	}
	const [first] = DEMO_SCENARIOS;
	if (!first) {
		throw new Error('Demo mode has no scenarios registered.');
	}
	return first;
}
