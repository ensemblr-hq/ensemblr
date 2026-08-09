import { expect, test } from 'vitest';

import {
	buildOnboardingSteps,
	ONBOARDING_SCREEN_ORDER,
	summarizeOnboarding,
	toOnboardingChecks,
} from '../../src/renderer/lib/onboarding';
import type {
	OnboardingCheckId,
	OnboardingCheckModel,
	OnboardingStepId,
} from '../../src/renderer/types/onboarding';
import type {
	SetupCheckId,
	SetupCheckSnapshot,
	SetupCheckStatus,
	SetupDiagnosticsSnapshot,
} from '../../src/shared/ipc';

const NOW = '2026-06-05T00:00:00.000Z';

const TITLES: Record<OnboardingCheckId, string> = {
	'claude-executable': 'Claude Code',
	'gh-auth': 'GitHub CLI signed in',
	'gh-cli': 'GitHub CLI installed',
	'linear-oauth': 'Linear account',
	'pi-executable': 'Pi',
};

function createSnapshotCheck(
	id: SetupCheckId,
	status: SetupCheckStatus,
): SetupCheckSnapshot {
	return {
		blocking: false,
		description: `${id} description`,
		detail: `${id} detail`,
		group: 'core',
		id,
		logs: [],
		remediationActions: [
			{ id: `retry-${id}`, kind: 'retry', label: `Retry ${id}` },
		],
		status,
		title: `${id} title`,
		updatedAt: NOW,
	};
}

function createSnapshot(
	checks: readonly SetupCheckSnapshot[],
): SetupDiagnosticsSnapshot {
	return {
		blockedCount: 0,
		checks: [...checks],
		generatedAt: NOW,
		optionalCount: 0,
		requiredCount: 0,
		status: 'ready',
		successCount: 0,
		warningCount: 0,
	};
}

function createCheck(
	id: OnboardingCheckId,
	status: SetupCheckStatus,
): OnboardingCheckModel {
	return {
		detail: `${id} detail`,
		id,
		remediations: [],
		status,
		title: TITLES[id],
	};
}

function statusOf(
	checks: readonly OnboardingCheckModel[] | null,
	id: OnboardingStepId,
) {
	return buildOnboardingSteps(checks, new Set()).find((step) => step.id === id)
		?.status;
}

test('toOnboardingChecks reports the pre-first-result state as null', () => {
	expect(toOnboardingChecks(undefined, TITLES)).toBeNull();
});

test('toOnboardingChecks keeps only the wizard checks, in card order', () => {
	const models = toOnboardingChecks(
		createSnapshot([
			createSnapshotCheck('linear-oauth', 'warning'),
			createSnapshotCheck('sqlite-database', 'success'),
			createSnapshotCheck('gh-auth', 'failure'),
			createSnapshotCheck('pi-executable', 'success'),
			createSnapshotCheck('config', 'success'),
			createSnapshotCheck('gh-cli', 'success'),
			createSnapshotCheck('claude-executable', 'failure'),
		]),
		TITLES,
	);

	expect(models?.map((model) => model.id)).toEqual([
		'pi-executable',
		'claude-executable',
		'gh-cli',
		'gh-auth',
		'linear-oauth',
	]);
});

test('toOnboardingChecks substitutes wizard titles and passes detail through', () => {
	const models = toOnboardingChecks(
		createSnapshot([createSnapshotCheck('pi-executable', 'success')]),
		TITLES,
	);

	expect(models?.[0]).toMatchObject({
		detail: 'pi-executable detail',
		status: 'success',
		title: 'Pi',
	});
	expect(models?.[0]?.remediations).toEqual([
		{ id: 'retry-pi-executable', kind: 'retry', label: 'Retry pi-executable' },
	]);
});

test('toOnboardingChecks omits a check the snapshot does not carry', () => {
	const models = toOnboardingChecks(
		createSnapshot([createSnapshotCheck('gh-cli', 'success')]),
		TITLES,
	);

	expect(models?.map((model) => model.id)).toEqual(['gh-cli']);
});

test('the agent-CLI gate is satisfied by Pi alone', () => {
	const checks = [
		createCheck('pi-executable', 'success'),
		createCheck('claude-executable', 'failure'),
	];

	expect(statusOf(checks, 'agent-cli')).toBe('satisfied');
});

test('the agent-CLI gate is satisfied by Claude alone', () => {
	const checks = [
		createCheck('pi-executable', 'failure'),
		createCheck('claude-executable', 'success'),
	];

	expect(statusOf(checks, 'agent-cli')).toBe('satisfied');
});

test('the agent-CLI gate is unmet when neither runtime resolved', () => {
	const checks = [
		createCheck('pi-executable', 'failure'),
		createCheck('claude-executable', 'failure'),
	];

	expect(statusOf(checks, 'agent-cli')).toBe('unmet');
});

test('the GitHub gate needs both of its checks', () => {
	expect(
		statusOf(
			[createCheck('gh-cli', 'success'), createCheck('gh-auth', 'failure')],
			'github',
		),
	).toBe('unmet');
	expect(
		statusOf(
			[createCheck('gh-cli', 'success'), createCheck('gh-auth', 'success')],
			'github',
		),
	).toBe('satisfied');
});

test('a step still probing reads as checking rather than unmet', () => {
	const checks = [
		createCheck('gh-cli', 'running'),
		createCheck('gh-auth', 'pending'),
	];

	expect(statusOf(checks, 'github')).toBe('checking');
});

test('a step reads as checking before its first result arrives', () => {
	expect(statusOf(null, 'agent-cli')).toBe('checking');
});

test('a deferred step reads as skipped without becoming satisfied', () => {
	const steps = buildOnboardingSteps(
		[createCheck('gh-cli', 'failure'), createCheck('gh-auth', 'failure')],
		new Set<OnboardingStepId>(['github']),
	);

	expect(steps.find((step) => step.id === 'github')?.status).toBe('skipped');
	expect(summarizeOnboarding(steps).isReady).toBe(false);
});

test('the optional Linear step never counts toward the required total', () => {
	const summary = summarizeOnboarding(
		buildOnboardingSteps(
			[
				createCheck('pi-executable', 'success'),
				createCheck('gh-cli', 'success'),
				createCheck('gh-auth', 'success'),
				createCheck('linear-oauth', 'warning'),
			],
			new Set(),
		),
	);

	expect(summary.totalCount).toBe(2);
	expect(summary.satisfiedCount).toBe(2);
	expect(summary.isReady).toBe(true);
	expect(summary.outstanding).toEqual([]);
});

test('a degraded-but-usable runtime satisfies the agent-CLI gate', () => {
	const checks = [
		createCheck('pi-executable', 'warning'),
		createCheck('claude-executable', 'failure'),
	];

	expect(statusOf(checks, 'agent-cli')).toBe('satisfied');
});

test('a warning on an unconnected Linear never reads as satisfied', () => {
	expect(statusOf([createCheck('linear-oauth', 'warning')], 'linear')).toBe(
		'unmet',
	);
	expect(statusOf([createCheck('linear-oauth', 'success')], 'linear')).toBe(
		'satisfied',
	);
});

test('the Pi card reports the whole runtime group, not just the executable', () => {
	const models = toOnboardingChecks(
		createSnapshot([
			createSnapshotCheck('pi-executable', 'success'),
			createSnapshotCheck('pi-rpc', 'failure'),
		]),
		TITLES,
	);

	expect(models).toEqual([
		{
			detail: 'pi-rpc detail',
			id: 'pi-executable',
			remediations: [
				{ id: 'retry-pi-rpc', kind: 'retry', label: 'Retry pi-rpc' },
			],
			status: 'failure',
			title: 'Pi',
		},
	]);
});

test('a Pi runtime blocked past its executable leaves the wizard unready', () => {
	const summary = summarizeOnboarding(
		buildOnboardingSteps(
			toOnboardingChecks(
				createSnapshot([
					createSnapshotCheck('pi-executable', 'success'),
					createSnapshotCheck('pi-rpc', 'failure'),
					createSnapshotCheck('gh-cli', 'success'),
					createSnapshotCheck('gh-auth', 'success'),
				]),
				TITLES,
			),
			new Set(),
		),
	);

	expect(summary.isReady).toBe(false);
	expect(summary.outstanding.map((step) => step.id)).toEqual(['agent-cli']);
});

test('the screen order brackets every gated step with the two bookends', () => {
	expect(ONBOARDING_SCREEN_ORDER).toEqual([
		'welcome',
		'agent-cli',
		'github',
		'linear',
		'ready',
	]);
});

test('an unresolved required step surfaces as outstanding work', () => {
	const summary = summarizeOnboarding(
		buildOnboardingSteps(
			[
				createCheck('pi-executable', 'success'),
				createCheck('gh-cli', 'failure'),
				createCheck('gh-auth', 'failure'),
			],
			new Set(),
		),
	);

	expect(summary.isReady).toBe(false);
	expect(summary.outstanding.map((step) => step.id)).toEqual(['github']);
});
