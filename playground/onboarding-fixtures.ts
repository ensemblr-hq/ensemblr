import type { OnboardingCheckModel } from '@/renderer/types/onboarding';
import type { SetupCheckStatus } from '@/shared/ipc/contracts/setup';

/** Machine states the scene can put the wizard into. */
export type OnboardingScenarioId =
	| 'all-pass'
	| 'claude-only'
	| 'gh-missing'
	| 'gh-unauthed'
	| 'loading'
	| 'nothing'
	| 'pi-only'
	| 'probing';

/** Linear states, including the one where the row is hidden entirely. */
export type LinearScenarioId = 'connected' | 'disconnected' | 'not-configured';

/** Scenario pills, in the order the scene's toolbar lists them. */
export const ONBOARDING_SCENARIOS = [
	{ id: 'loading', label: 'loading' },
	{ id: 'probing', label: 'probing' },
	{ id: 'nothing', label: 'nothing' },
	{ id: 'pi-only', label: 'pi' },
	{ id: 'claude-only', label: 'claude' },
	{ id: 'gh-missing', label: 'no gh' },
	{ id: 'gh-unauthed', label: 'gh unauthed' },
	{ id: 'all-pass', label: 'all pass' },
] as const satisfies readonly { id: OnboardingScenarioId; label: string }[];

/** Linear pills, in toolbar order. */
export const LINEAR_SCENARIOS = [
	{ id: 'disconnected', label: 'disconnected' },
	{ id: 'connected', label: 'connected' },
	{ id: 'not-configured', label: 'unconfigured' },
] as const satisfies readonly { id: LinearScenarioId; label: string }[];

/** Per-scenario probe outcomes for the four essential checks. */
const SCENARIO_STATUSES: Record<
	Exclude<OnboardingScenarioId, 'loading'>,
	{
		claude: SetupCheckStatus;
		ghAuth: SetupCheckStatus;
		ghCli: SetupCheckStatus;
		pi: SetupCheckStatus;
	}
> = {
	'all-pass': {
		claude: 'success',
		ghAuth: 'success',
		ghCli: 'success',
		pi: 'success',
	},
	'claude-only': {
		claude: 'success',
		ghAuth: 'success',
		ghCli: 'success',
		pi: 'failure',
	},
	'gh-missing': {
		claude: 'success',
		ghAuth: 'pending',
		ghCli: 'failure',
		pi: 'failure',
	},
	'gh-unauthed': {
		claude: 'success',
		ghAuth: 'failure',
		ghCli: 'success',
		pi: 'failure',
	},
	nothing: {
		claude: 'failure',
		ghAuth: 'pending',
		ghCli: 'failure',
		pi: 'failure',
	},
	'pi-only': {
		claude: 'failure',
		ghAuth: 'success',
		ghCli: 'success',
		pi: 'success',
	},
	probing: {
		claude: 'running',
		ghAuth: 'running',
		ghCli: 'running',
		pi: 'running',
	},
};

/**
 * Builds the probe results behind one scene permutation.
 * @param scenario - Which machine state to render.
 * @param linear - Linear connection state, independent of the essentials.
 * @returns The check models, or null for the pre-first-result state.
 */
export function buildOnboardingChecks(
	scenario: OnboardingScenarioId,
	linear: LinearScenarioId,
): OnboardingCheckModel[] | null {
	if (scenario === 'loading') {
		return null;
	}

	const statuses = SCENARIO_STATUSES[scenario];
	const linearCheck = buildLinearCheck(linear, scenario === 'probing');

	return [
		buildPiCheck(statuses.pi),
		buildClaudeCheck(statuses.claude),
		buildGitHubCliCheck(statuses.ghCli),
		buildGitHubAuthCheck(statuses.ghAuth),
		...(linearCheck ? [linearCheck] : []),
	];
}

/**
 * Claude Code executable probe. Copy follows the shipped install command in
 * `src/shared/agent-provider.ts` rather than inventing a package name.
 * @param status - Outcome to render.
 * @returns The check model.
 */
function buildClaudeCheck(status: SetupCheckStatus): OnboardingCheckModel {
	return {
		detail: describeExecutable(
			status,
			'Claude Code is available: claude 2.1.220.',
			'Claude Code was not found in the shell-derived PATH. Install it, then retry.',
			'Looking for the Claude Code executable…',
		),
		id: 'claude-executable',
		remediations:
			status === 'failure'
				? [
						{
							command: 'curl -fsSL https://claude.ai/install.sh | bash',
							id: 'install-claude',
							kind: 'run-command',
							label: 'Install Claude Code',
						},
						{
							id: 'open-claude-docs',
							kind: 'open-external',
							label: 'Open install docs',
							target: 'https://docs.claude.com/en/docs/claude-code/setup',
						},
					]
				: [],
		status,
		title: 'Claude Code',
	};
}

/**
 * Pi executable probe. Pi ships with a path override, so its remediation offers
 * a picker where Claude's offers an installer.
 * @param status - Outcome to render.
 * @returns The check model.
 */
function buildPiCheck(status: SetupCheckStatus): OnboardingCheckModel {
	return {
		detail: describeExecutable(
			status,
			'Pi is available: pi 0.42.1.',
			'Pi was not found in the shell-derived PATH. Install pi or point Ensemblr at it, then retry.',
			'Looking for the Pi executable…',
		),
		id: 'pi-executable',
		remediations:
			status === 'failure'
				? [
						{
							command: 'curl -fsSL https://pi.dev/install.sh | sh',
							id: 'install-pi',
							kind: 'run-command',
							label: 'Install Pi',
						},
						{
							id: 'open-pi-docs',
							kind: 'open-external',
							label: 'Open install docs',
							target: 'https://pi.dev',
						},
						{
							id: 'select-pi-executable',
							kind: 'select-path',
							label: 'Select Pi executable',
						},
					]
				: [],
		status,
		title: 'Pi',
	};
}

/**
 * `gh --version` probe. Detail strings are lifted verbatim from
 * `src/main/setup/setup-checks-github.ts` so the mock cannot drift from ship.
 * @param status - Outcome to render.
 * @returns The check model.
 */
function buildGitHubCliCheck(status: SetupCheckStatus): OnboardingCheckModel {
	return {
		detail: describeExecutable(
			status,
			'GitHub CLI is available: gh version 2.63.2 (2025-01-14).',
			'GitHub CLI was not found in the shell-derived PATH. Install gh, then retry.',
			'Looking for the GitHub CLI…',
		),
		id: 'gh-cli',
		remediations:
			status === 'failure'
				? [
						{
							command: 'brew install gh',
							id: 'install-gh',
							kind: 'run-command',
							label: 'Install with Homebrew',
						},
						{
							id: 'open-gh-install',
							kind: 'open-external',
							label: 'Open GitHub CLI install docs',
							target: 'https://cli.github.com/',
						},
					]
				: [],
		status,
		title: 'GitHub CLI installed',
	};
}

/**
 * `gh auth status` probe. The `pending` case is the cascade shown while the CLI
 * itself is missing, so the step reports one problem rather than two.
 * @param status - Outcome to render.
 * @returns The check model.
 */
function buildGitHubAuthCheck(status: SetupCheckStatus): OnboardingCheckModel {
	return {
		detail: describeExecutable(
			status,
			'GitHub CLI is authenticated for github.com.',
			'GitHub CLI is not authenticated for github.com. Run gh auth login --hostname github.com, then retry.',
			'Checking the signed-in GitHub account…',
			'Waiting for the GitHub CLI.',
		),
		id: 'gh-auth',
		remediations:
			status === 'failure'
				? [
						{
							command: 'gh auth login --hostname github.com',
							id: 'run-gh-auth-login',
							kind: 'run-command',
							label: 'Run gh auth login',
						},
					]
				: [],
		status,
		title: 'GitHub CLI signed in',
	};
}

/**
 * Linear connection probe, or null when Linear has no client id — that state is
 * not user-fixable, so the row is hidden rather than shown as a failure.
 * @param linear - Linear connection state.
 * @param isProbing - Whether the scene is in its probing state.
 * @returns The check model, or null when the row should not render.
 */
function buildLinearCheck(
	linear: LinearScenarioId,
	isProbing: boolean,
): OnboardingCheckModel | null {
	if (linear === 'not-configured') {
		return null;
	}

	const connected = linear === 'connected';
	const status: SetupCheckStatus = isProbing
		? 'running'
		: connected
			? 'success'
			: 'warning';

	return {
		detail: isProbing
			? 'Checking the connected Linear account…'
			: connected
				? 'Linear is connected as Ada (Example Org).'
				: 'Linear is not connected. Sign in to browse issues from inside Ensemblr.',
		id: 'linear-oauth',
		remediations: connected
			? []
			: [
					{
						id: 'connect-linear',
						kind: 'open-settings',
						label: 'Connect Linear',
					},
				],
		status,
		title: 'Linear account',
	};
}

/**
 * Picks the detail line matching a probe outcome.
 * @param status - Outcome to describe.
 * @param success - Line shown once the probe passes.
 * @param failure - Line shown when the probe fails.
 * @param running - Line shown while the probe is in flight.
 * @param pending - Line shown when the probe is waiting on a prerequisite.
 * @returns The detail line for that outcome.
 */
function describeExecutable(
	status: SetupCheckStatus,
	success: string,
	failure: string,
	running: string,
	pending = 'Not checked yet.',
): string {
	switch (status) {
		case 'failure':
			return failure;
		case 'pending':
			return pending;
		case 'running':
			return running;
		case 'success':
			return success;
		case 'warning':
			return failure;
	}
}
