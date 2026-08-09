import type {
	SetupCheckId,
	SetupCheckStatus,
	SetupRemediationActionKind,
} from '@/shared/ipc/contracts/setup';

/**
 * The probes the onboarding wizard surfaces — the subset of the shipped setup
 * checks that a first run can act on. Diagnostics carries the rest.
 */
export type OnboardingCheckId = Extract<
	SetupCheckId,
	'claude-executable' | 'gh-auth' | 'gh-cli' | 'linear-oauth' | 'pi-executable'
>;

/** One screen of the wizard, in the order it is presented. */
export type OnboardingScreenId =
	| 'agent-cli'
	| 'github'
	| 'linear'
	| 'ready'
	| 'welcome';

/**
 * The three gated screens. `welcome` and `ready` bookend them and gate nothing,
 * so they carry no checks and never appear in the progress count.
 */
export type OnboardingStepId = Exclude<OnboardingScreenId, 'ready' | 'welcome'>;

/**
 * How a step's checks combine. `any` is what lets a machine with only Claude or
 * only Pi read as ready instead of half-broken; `connected` demands an outright
 * `success` rather than the app's looser "usable" bar, for the integrations the
 * wizard must not draw as done while they are merely not blocking anything.
 */
export type OnboardingGate = 'all' | 'any' | 'connected';

/**
 * Aggregate state of one step. `unmet` is deliberately neutral — whether it
 * reads as an error or as an untaken option is decided by `required`, so the
 * optional Linear step never renders in a danger tone.
 */
export type OnboardingStepStatus =
	| 'checking'
	| 'satisfied'
	| 'skipped'
	| 'unmet';

/** A fix offered on a failing check, mirroring `SetupRemediationAction`. */
export interface OnboardingRemediation {
	command?: string;
	id: string;
	kind: SetupRemediationActionKind;
	label: string;
	target?: string;
}

/** One probe result rendered as a card inside a step. */
export interface OnboardingCheckModel {
	detail: string;
	id: OnboardingCheckId;
	remediations: OnboardingRemediation[];
	status: SetupCheckStatus;
	title: string;
}

/** Everything a step needs to render itself and report whether it is passable. */
export interface OnboardingStepModel {
	checks: OnboardingCheckModel[];
	gate: OnboardingGate;
	id: OnboardingStepId;
	required: boolean;
	status: OnboardingStepStatus;
}

/** Rollup driving the header progress bar and the outstanding-work list. */
export interface OnboardingSummary {
	isReady: boolean;
	outstanding: OnboardingStepModel[];
	satisfiedCount: number;
	totalCount: number;
}
