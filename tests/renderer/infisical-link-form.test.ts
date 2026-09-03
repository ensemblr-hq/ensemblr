import { expect, test } from 'vitest';

import {
	EMPTY_INFISICAL_DRAFT,
	normalizeSecretPath,
	resolveInfisicalLinkForm,
} from '../../src/renderer/components/settings/repo-infisical/infisical-link-form';
import type {
	InfisicalAccountSnapshot,
	InfisicalLinkSnapshot,
	InfisicalProjectSnapshot,
} from '../../src/shared/ipc/contracts/infisical';

/** Builds a configured account, overridable per test. */
function account(
	overrides: Partial<InfisicalAccountSnapshot> & { id: string },
): InfisicalAccountSnapshot {
	return {
		clientId: `client-${overrides.id}`,
		createdAt: '2026-08-01T00:00:00.000Z',
		label: overrides.id,
		lastErrorCode: null,
		lastVerifiedAt: null,
		maskedClientSecret: null,
		siteUrl: 'https://app.infisical.com',
		updatedAt: '2026-08-01T00:00:00.000Z',
		...overrides,
	};
}

const cloudAccounts = [account({ id: 'acc-1' }), account({ id: 'acc-2' })];

/** Resolves the form with the cloud accounts every test shares by default. */
function resolveForm(
	input: Partial<Parameters<typeof resolveInfisicalLinkForm>[0]> & {
		draft: Parameters<typeof resolveInfisicalLinkForm>[0]['draft'];
	},
): ReturnType<typeof resolveInfisicalLinkForm> {
	return resolveInfisicalLinkForm({
		accounts: cloudAccounts,
		link: null,
		projects: [],
		projectsLoaded: true,
		...input,
	});
}

const backend: InfisicalProjectSnapshot = {
	accountId: 'acc-1',
	accountLabel: 'Work',
	environments: [
		{ name: 'Development', slug: 'dev' },
		{ name: 'Production', slug: 'prod' },
	],
	id: 'proj-1',
	name: 'Backend',
	slug: 'backend',
};

const frontend: InfisicalProjectSnapshot = {
	accountId: 'acc-2',
	accountLabel: 'Acme',
	environments: [{ name: 'Staging', slug: 'staging' }],
	id: 'proj-2',
	name: 'Frontend',
	slug: 'frontend',
};

/** Builds a saved link, overridable per test. */
function savedLink(
	overrides: Partial<InfisicalLinkSnapshot> = {},
): InfisicalLinkSnapshot {
	return {
		accountId: 'acc-1',
		accountLabel: 'Work',
		enabled: true,
		environmentSlug: 'dev',
		lastSyncedAt: null,
		origin: 'local',
		projectId: 'proj-1',
		projectName: 'Backend',
		recursive: false,
		scope: 'repository',
		scopeId: 'repo-1',
		secretPath: '/',
		siteUrl: 'https://app.infisical.com',
		...overrides,
	};
}

test('a saved link with no edits is clean and cannot be saved again', () => {
	const form = resolveForm({
		draft: EMPTY_INFISICAL_DRAFT,
		link: savedLink(),
		projects: [backend, frontend],
		projectsLoaded: true,
	});

	expect(form.isDirty).toBe(false);
	expect(form.canSave).toBe(false);
	expect(form.project?.id).toBe('proj-1');
	expect(form.environmentSlug).toBe('dev');
});

test('an unlinked repository becomes saveable once a project and environment are picked', () => {
	const picked = resolveForm({
		draft: { ...EMPTY_INFISICAL_DRAFT, projectKey: 'acc-2:proj-2' },
		link: null,
		projects: [backend, frontend],
		projectsLoaded: true,
	});

	expect(picked.isDirty).toBe(true);
	expect(picked.canSave).toBe(false);

	const complete = resolveForm({
		draft: {
			...EMPTY_INFISICAL_DRAFT,
			environmentSlug: 'staging',
			projectKey: 'acc-2:proj-2',
		},
		link: null,
		projects: [backend, frontend],
		projectsLoaded: true,
	});

	expect(complete.canSave).toBe(true);
	expect(complete.project?.accountId).toBe('acc-2');
});

test('an environment slug the newly picked project happens to share is still dropped', () => {
	const otherWithSameSlug: InfisicalProjectSnapshot = {
		...frontend,
		environments: [{ name: 'Development', slug: 'dev' }],
	};

	const form = resolveForm({
		draft: { ...EMPTY_INFISICAL_DRAFT, projectKey: 'acc-2:proj-2' },
		link: savedLink(),
		projects: [backend, otherWithSameSlug],
		projectsLoaded: true,
	});

	expect(form.project?.id).toBe('proj-2');
	expect(form.environmentSlug).toBeNull();
	expect(form.canSave).toBe(false);
});

test('an environment the newly picked project does not have is dropped', () => {
	const form = resolveForm({
		draft: { ...EMPTY_INFISICAL_DRAFT, projectKey: 'acc-2:proj-2' },
		link: savedLink(),
		projects: [backend, frontend],
		projectsLoaded: true,
	});

	expect(form.environmentSlug).toBeNull();
	expect(form.environments.map((environment) => environment.slug)).toEqual([
		'staging',
	]);
});

test('a committed link with no local account resolves against the aggregated list', () => {
	const form = resolveForm({
		draft: EMPTY_INFISICAL_DRAFT,
		link: savedLink({
			accountId: null,
			accountLabel: null,
			origin: 'repository-config',
		}),
		projects: [backend, frontend],
		projectsLoaded: true,
	});

	expect(form.project?.accountId).toBe('acc-1');
	expect(form.isDirty).toBe(true);
	expect(form.canSave).toBe(true);
	expect(form.unreachableProjectId).toBeNull();
});

test('a linked project no account can reach is reported rather than silently cleared', () => {
	const form = resolveForm({
		draft: EMPTY_INFISICAL_DRAFT,
		link: savedLink({ accountId: null, projectId: 'proj-gone' }),
		projects: [backend],
		projectsLoaded: true,
	});

	expect(form.project).toBeNull();
	expect(form.unreachableProjectId).toBe('proj-gone');
	expect(form.canSave).toBe(false);
});

test('the saved environment still shows while the project list is loading', () => {
	const form = resolveForm({
		draft: EMPTY_INFISICAL_DRAFT,
		link: savedLink(),
		projects: [],
		projectsLoaded: false,
	});

	expect(form.environmentSlug).toBe('dev');
	expect(form.environments).toEqual([{ name: 'dev', slug: 'dev' }]);
	expect(form.unreachableProjectId).toBeNull();
	expect(form.isDirty).toBe(false);
});

test('a path edit that normalises back to the saved value is not a change', () => {
	const form = resolveForm({
		draft: { ...EMPTY_INFISICAL_DRAFT, secretPath: '  /backend/  ' },
		link: savedLink({ secretPath: '/backend' }),
		projects: [backend],
		projectsLoaded: true,
	});

	expect(form.isDirty).toBe(false);
});

test('a committed project id two instances both answer for is left for the user', () => {
	const selfHostedTwin: InfisicalProjectSnapshot = {
		...backend,
		accountId: 'acc-self',
		accountLabel: 'Self-hosted',
	};

	const form = resolveForm({
		accounts: [...cloudAccounts, account({ id: 'acc-self', siteUrl: '' })],
		draft: EMPTY_INFISICAL_DRAFT,
		link: savedLink({ accountId: null, siteUrl: null }),
		projects: [backend, selfHostedTwin],
	});

	expect(form.project).toBeNull();
	expect(form.canSave).toBe(false);
});

test('a committed link resolves to the project on its own instance', () => {
	const selfHostedTwin: InfisicalProjectSnapshot = {
		...backend,
		accountId: 'acc-self',
		accountLabel: 'Self-hosted',
	};

	const form = resolveForm({
		accounts: [
			...cloudAccounts,
			account({ id: 'acc-self', siteUrl: 'https://vault.example.com' }),
		],
		draft: EMPTY_INFISICAL_DRAFT,
		link: savedLink({ accountId: null, siteUrl: 'https://vault.example.com' }),
		projects: [backend, selfHostedTwin],
	});

	expect(form.project?.accountId).toBe('acc-self');
	expect(form.canSave).toBe(true);
});

test('normalizeSecretPath roots the path and drops trailing slashes', () => {
	expect(normalizeSecretPath('')).toBe('/');
	expect(normalizeSecretPath('   ')).toBe('/');
	expect(normalizeSecretPath('backend')).toBe('/backend');
	expect(normalizeSecretPath('/backend/')).toBe('/backend');
	expect(normalizeSecretPath('/backend/api//')).toBe('/backend/api');
});
