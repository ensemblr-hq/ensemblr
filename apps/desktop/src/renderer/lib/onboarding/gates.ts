import type {
	OnboardingCheckId,
	OnboardingCheckModel,
	OnboardingGate,
	OnboardingScreenId,
	OnboardingStepId,
	OnboardingStepModel,
	OnboardingStepStatus,
	OnboardingSummary,
} from '@/renderer/types/onboarding';
import { isPassingSetupStatus } from '@/shared/setup-checks';

const STEP_DEFINITIONS: readonly {
	checkIds: readonly OnboardingCheckId[];
	gate: OnboardingGate;
	id: OnboardingStepId;
	required: boolean;
}[] = [
	{
		checkIds: ['pi-executable', 'claude-executable'],
		gate: 'any',
		id: 'agent-cli',
		required: true,
	},
	{
		checkIds: ['gh-cli', 'gh-auth'],
		gate: 'all',
		id: 'github',
		required: true,
	},
	{
		checkIds: ['linear-oauth'],
		gate: 'connected',
		id: 'linear',
		required: false,
	},
];

/**
 * Screen order for the rail and for forward/back navigation: the gated steps in
 * declaration order, between the two bookend screens that gate nothing. Derived
 * rather than written out, so a step added to {@link STEP_DEFINITIONS} cannot
 * type-check its way into a build that never navigates to it.
 */
export const ONBOARDING_SCREEN_ORDER: readonly OnboardingScreenId[] = [
	'welcome',
	...STEP_DEFINITIONS.map((definition) => definition.id),
	'ready',
];

/**
 * Groups a probe result set into the wizard's three gates.
 * @param checks - Every probe result, or null before the first result arrives.
 * @param skipped - Steps the user chose to come back to later.
 * @returns One model per gated step, in screen order.
 */
export function buildOnboardingSteps(
	checks: readonly OnboardingCheckModel[] | null,
	skipped: ReadonlySet<OnboardingStepId>,
): OnboardingStepModel[] {
	return STEP_DEFINITIONS.map((definition) => {
		const stepChecks = collectChecks(checks, definition.checkIds);

		return {
			checks: stepChecks,
			gate: definition.gate,
			id: definition.id,
			required: definition.required,
			status: resolveStepStatus(
				definition.gate,
				stepChecks,
				skipped.has(definition.id),
			),
		};
	});
}

/**
 * Rolls the required steps up into the progress bar and the finish gate.
 * @param steps - Models from {@link buildOnboardingSteps}.
 * @returns Satisfied and total required counts, plus what is still outstanding.
 */
export function summarizeOnboarding(
	steps: readonly OnboardingStepModel[],
): OnboardingSummary {
	const required = steps.filter((step) => step.required);
	const satisfied = required.filter((step) => step.status === 'satisfied');

	return {
		isReady: satisfied.length === required.length,
		outstanding: required.filter((step) => step.status !== 'satisfied'),
		satisfiedCount: satisfied.length,
		totalCount: required.length,
	};
}

/**
 * Picks a step's checks out of the result set, preserving declared card order.
 * @param checks - Every probe result, or null before the first result arrives.
 * @param ids - Check ids belonging to the step.
 * @returns The matching checks, empty while results are missing.
 */
function collectChecks(
	checks: readonly OnboardingCheckModel[] | null,
	ids: readonly OnboardingCheckId[],
): OnboardingCheckModel[] {
	if (!checks) {
		return [];
	}

	return ids.flatMap((id) => checks.filter((check) => check.id === id));
}

/**
 * Reduces a step's checks to one status under its gate.
 * @param gate - How the step's checks combine.
 * @param checks - The step's checks.
 * @param isSkipped - Whether the user deferred this step.
 * @returns The aggregate status the rail and stage render.
 */
function resolveStepStatus(
	gate: OnboardingGate,
	checks: readonly OnboardingCheckModel[],
	isSkipped: boolean,
): OnboardingStepStatus {
	if (!checks.length) {
		return isSkipped ? 'skipped' : 'checking';
	}

	if (meetsGate(gate, checks)) {
		return 'satisfied';
	}

	if (isSkipped) {
		return 'skipped';
	}

	return checks.some((check) => check.status === 'running')
		? 'checking'
		: 'unmet';
}

/**
 * Applies one gate to a step's checks.
 *
 * `all` and `any` ask the app's own question — is this usable? — so a degraded
 * but working runtime clears them, exactly as it clears the diagnostics rollup.
 * `connected` is stricter because `warning` does not mean the same thing on
 * every check: `linear-oauth` reports it for "not connected", which the app is
 * content to ignore and the wizard must not draw as a satisfied step.
 * @param gate - The step's gate.
 * @param checks - The step's checks.
 * @returns True when the gate is met.
 */
function meetsGate(
	gate: OnboardingGate,
	checks: readonly OnboardingCheckModel[],
): boolean {
	if (gate === 'connected') {
		return checks.every((check) => check.status === 'success');
	}

	const passedCount = checks.filter((check) =>
		isPassingSetupStatus(check.status),
	).length;

	return gate === 'all' ? passedCount === checks.length : passedCount > 0;
}
