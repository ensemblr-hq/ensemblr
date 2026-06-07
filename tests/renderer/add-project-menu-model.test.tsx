import { expect, test } from 'bun:test';

import { buildAddProjectMenuModel } from '../../src/renderer/lib/workbench';
import { defaultRecentProjects } from '../../src/renderer/fixtures/workbench';
import type { RecentProject } from '../../src/renderer/types/workbench';
import type {
	SetupCheckGroupId,
	SetupCheckId,
	SetupCheckSnapshot,
	SetupCheckStatus,
	SetupDiagnosticsSnapshot,
} from '../../src/shared/ipc';

const NOW = '2026-06-07T00:00:00.000Z';
const GROUP_BY_ID: Partial<Record<SetupCheckId, SetupCheckGroupId>> = {
	'gh-auth': 'github',
	'gh-cli': 'github',
	'root-directory': 'storage',
};

const RECENTS: RecentProject[] = [
	{ lastOpenedAt: NOW, name: 'alpha', path: '~/Projects/alpha' },
	{ lastOpenedAt: NOW, name: 'beta', path: '~/Projects/beta' },
];

function createCheck({
	detail,
	id,
	status = 'success',
	title,
}: {
	detail?: string;
	id: SetupCheckId;
	status?: SetupCheckStatus;
	title?: string;
}): SetupCheckSnapshot {
	return {
		blocking: true,
		description: `${id} description`,
		detail: detail ?? `${id} detail`,
		group: GROUP_BY_ID[id] ?? 'core',
		id,
		logs: [],
		remediationActions: [],
		status,
		title: title ?? id,
		updatedAt: NOW,
	};
}

function createSnapshot(
	checks: SetupCheckSnapshot[],
	status: SetupDiagnosticsSnapshot['status'] = 'ready',
): SetupDiagnosticsSnapshot {
	return {
		blockedCount: checks.filter((check) => check.status === 'failure').length,
		checks,
		generatedAt: NOW,
		optionalCount: 0,
		requiredCount: checks.length,
		status,
		successCount: checks.filter((check) => check.status === 'success').length,
		warningCount: checks.filter((check) => check.status === 'warning').length,
	};
}

function findAction(
	model: ReturnType<typeof buildAddProjectMenuModel>,
	id: string,
) {
	const action = model.actions.find((candidate) => candidate.id === id);
	if (!action) {
		throw new Error(`Add-project action ${id} was not modeled.`);
	}
	return action;
}

const READY_SNAPSHOT = createSnapshot([
	createCheck({ id: 'gh-cli' }),
	createCheck({ id: 'gh-auth' }),
	createCheck({ id: 'root-directory' }),
]);

test('models only project-level add actions in a stable order', () => {
	const model = buildAddProjectMenuModel({
		recents: [],
		setupSnapshot: READY_SNAPSHOT,
	});

	expect(model.actions.map((action) => action.id)).toEqual([
		'open-local',
		'open-github',
		'quick-start',
	]);
	expect(model.actions.map((action) => action.label)).toEqual([
		'Open local project',
		'Open GitHub project',
		'Quick start',
	]);
});

test('enables every action when prerequisites pass', () => {
	const model = buildAddProjectMenuModel({
		recents: RECENTS,
		setupSnapshot: READY_SNAPSHOT,
	});

	for (const action of model.actions) {
		expect(action.enabled).toBe(true);
		expect(action.unavailableReason).toBeNull();
	}
});

test('stays optimistic when diagnostics are unavailable', () => {
	const model = buildAddProjectMenuModel({
		recents: [],
		setupSnapshot: null,
	});

	for (const action of model.actions) {
		expect(action.enabled).toBe(true);
		expect(action.unavailableReason).toBeNull();
	}
});

test('disables GitHub project when the GitHub CLI is missing', () => {
	const model = buildAddProjectMenuModel({
		recents: [],
		setupSnapshot: createSnapshot(
			[
				createCheck({
					detail: 'Install the GitHub CLI, then run gh auth login.',
					id: 'gh-cli',
					status: 'failure',
				}),
				createCheck({ id: 'gh-auth' }),
				createCheck({ id: 'root-directory' }),
			],
			'blocked',
		),
	});

	const github = findAction(model, 'open-github');
	expect(github.enabled).toBe(false);
	expect(github.unavailableReason).toBe(
		'Install the GitHub CLI, then run gh auth login.',
	);
	expect(findAction(model, 'open-local').enabled).toBe(true);
	expect(findAction(model, 'quick-start').enabled).toBe(true);
});

test('disables GitHub project when the GitHub CLI is unauthenticated', () => {
	const model = buildAddProjectMenuModel({
		recents: [],
		setupSnapshot: createSnapshot(
			[
				createCheck({ id: 'gh-cli' }),
				createCheck({
					detail: 'Run gh auth login to authenticate.',
					id: 'gh-auth',
					status: 'failure',
				}),
				createCheck({ id: 'root-directory' }),
			],
			'blocked',
		),
	});

	expect(findAction(model, 'open-github').enabled).toBe(false);
	expect(findAction(model, 'open-github').unavailableReason).toBe(
		'Run gh auth login to authenticate.',
	);
});

test('disables local and quick start when the root directory is not writable', () => {
	const model = buildAddProjectMenuModel({
		recents: [],
		setupSnapshot: createSnapshot(
			[
				createCheck({ id: 'gh-cli' }),
				createCheck({ id: 'gh-auth' }),
				createCheck({
					detail: 'Choose a writable Ensemble root directory.',
					id: 'root-directory',
					status: 'failure',
				}),
			],
			'blocked',
		),
	});

	expect(findAction(model, 'open-local').enabled).toBe(false);
	expect(findAction(model, 'open-local').unavailableReason).toBe(
		'Choose a writable Ensemble root directory.',
	);
	expect(findAction(model, 'quick-start').enabled).toBe(false);
	expect(findAction(model, 'open-github').enabled).toBe(true);
});

test('keeps actions enabled while a prerequisite check is still running', () => {
	const model = buildAddProjectMenuModel({
		recents: [],
		setupSnapshot: createSnapshot(
			[
				createCheck({ id: 'root-directory', status: 'pending' }),
				createCheck({ id: 'gh-cli', status: 'running' }),
				createCheck({ id: 'gh-auth', status: 'running' }),
			],
			'checking',
		),
	});

	for (const action of model.actions) {
		expect(action.enabled).toBe(true);
	}
});

test('treats warning prerequisites as satisfied', () => {
	const model = buildAddProjectMenuModel({
		recents: [],
		setupSnapshot: createSnapshot([
			createCheck({ id: 'root-directory', status: 'warning' }),
			createCheck({ id: 'gh-cli' }),
			createCheck({ id: 'gh-auth' }),
		]),
	});

	expect(findAction(model, 'open-local').enabled).toBe(true);
	expect(findAction(model, 'quick-start').enabled).toBe(true);
});

test('falls back to the action reason when a failed check has no detail', () => {
	const model = buildAddProjectMenuModel({
		recents: [],
		setupSnapshot: createSnapshot(
			[
				createCheck({
					detail: '   ',
					id: 'gh-cli',
					status: 'failure',
					title: '',
				}),
				createCheck({ id: 'gh-auth' }),
			],
			'blocked',
		),
	});

	expect(findAction(model, 'open-github').unavailableReason).toBe(
		'Sign in with the GitHub CLI (gh auth login) to open GitHub projects.',
	);
});

test('passes recents through unchanged, including the empty case', () => {
	expect(
		buildAddProjectMenuModel({
			recents: RECENTS,
			setupSnapshot: READY_SNAPSHOT,
		}).recents,
	).toBe(RECENTS);
	expect(
		buildAddProjectMenuModel({ recents: [], setupSnapshot: READY_SNAPSHOT })
			.recents,
	).toEqual([]);
});

test('seeded recents are local-only path entries without telemetry fields', () => {
	for (const recent of defaultRecentProjects) {
		expect(Object.keys(recent).sort()).toEqual([
			'lastOpenedAt',
			'name',
			'path',
		]);
		expect(recent.path.startsWith('~/')).toBe(true);
	}
});
