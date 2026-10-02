import type { DemoScenario } from '../scenario.ts';
import afkMode from './afk-mode.ts';
import afkModeReport from './afk-mode-report.ts';
import agentsHistory from './agents-history.ts';
import agentsPanel from './agents-panel.ts';
import architecture from './architecture.ts';
import board from './board.ts';
import boardCardMenu from './board-card-menu.ts';
import checksPullRequest from './checks-pull-request.ts';
import concierge from './concierge.ts';
import conciergeDelegation from './concierge-delegation.ts';
import createWorkspaceBranches from './create-workspace-branches.ts';
import createWorkspaceSources from './create-workspace-sources.ts';
import dockRunPicker from './dock-run-picker.ts';
import dockTerminal from './dock-terminal.ts';
import harnessLauncher from './harness-launcher.ts';
import heroOrchestrator from './hero-orchestrator.ts';
import linearIssueDetail from './linear-issue-detail.ts';
import linearIssues from './linear-issues.ts';
import onboardingAgentCli from './onboarding-agent-cli.ts';
import onboardingWelcome from './onboarding-welcome.ts';
import planMode from './plan-mode.ts';
import repoSettingsActions from './repo-settings-actions.ts';
import repoSettingsEnvironment from './repo-settings-environment.ts';
import repoSettingsGit from './repo-settings-git.ts';
import repoSettingsMisc from './repo-settings-misc.ts';
import repoSettingsScripts from './repo-settings-scripts.ts';
import repoSettingsSecrets from './repo-settings-secrets.ts';
import repoSettingsSecurity from './repo-settings-security.ts';
import reviewChanges from './review-changes.ts';
import settingsAppearance from './settings-appearance.ts';
import settingsDiagnostics from './settings-diagnostics.ts';
import settingsEnvironment from './settings-environment.ts';
import settingsExperimental from './settings-experimental.ts';
import settingsGeneral from './settings-general.ts';
import settingsGit from './settings-git.ts';
import settingsIntegrations from './settings-integrations.ts';
import settingsModels from './settings-models.ts';
import settingsProviders from './settings-providers.ts';
import settingsProvidersClaude from './settings-providers-claude.ts';
import settingsShortcuts from './settings-shortcuts.ts';
import subagentFanout from './subagent-fanout.ts';
import updateAvailable from './update-available.ts';
import updateFailure from './update-failure.ts';
import workspaceFiles from './workspace-files.ts';
import workspaceHistory from './workspace-history.ts';
import workspaceMidTurn from './workspace-mid-turn.ts';
import workspaceMidTurnLight from './workspace-mid-turn-light.ts';

/**
 * Every scenario demo mode can apply, in the order the toolbar lists them. Add a
 * scenario file and its entry here; nothing else registers one.
 */
export const DEMO_SCENARIOS: readonly DemoScenario[] = [
	heroOrchestrator,
	agentsPanel,
	agentsHistory,
	architecture,
	workspaceFiles,
	workspaceHistory,
	linearIssueDetail,
	harnessLauncher,
	updateAvailable,
	updateFailure,
	workspaceMidTurn,
	workspaceMidTurnLight,
	planMode,
	afkMode,
	afkModeReport,
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
	conciergeDelegation,
	onboardingWelcome,
	onboardingAgentCli,
	settingsProviders,
	settingsProvidersClaude,
	settingsGeneral,
	settingsDiagnostics,
	settingsShortcuts,
	settingsAppearance,
	settingsEnvironment,
	settingsExperimental,
	settingsGit,
	settingsIntegrations,
	settingsModels,
	repoSettingsActions,
	repoSettingsEnvironment,
	repoSettingsGit,
	repoSettingsMisc,
	repoSettingsScripts,
	repoSettingsSecrets,
	repoSettingsSecurity,
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
