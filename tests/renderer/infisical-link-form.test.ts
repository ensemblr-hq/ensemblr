import { expect, test } from 'vitest';

import {
	EMPTY_INFISICAL_DRAFT,
	normalizeSecretPath,
	resolveInfisicalLinkForm,
} from '../../src/renderer/components/settings/repo-infisical/infisical-link-form';
import type {
	InfisicalLinkSnapshot,
	InfisicalProjectSnapshot,
} from '../../src/shared/ipc/contracts/infisical';

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
		fromRepositoryConfig: false,
		lastSyncedAt: null,
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
	const form = resolveInfisicalLinkForm({
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
	const picked = resolveInfisicalLinkForm({
		draft: { ...EMPTY_INFISICAL_DRAFT, projectKey: 'acc-2:proj-2' },
		link: null,
		projects: [backend, frontend],
		projectsLoaded: true,
	});

	expect(picked.isDirty).toBe(true);
	expect(picked.canSave).toBe(false);

	const complete = resolveInfisicalLinkForm({
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

	const form = resolveInfisicalLinkForm({
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
	const form = resolveInfisicalLinkForm({
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
	const form = resolveInfisicalLinkForm({
		draft: EMPTY_INFISICAL_DRAFT,
		link: savedLink({
			accountId: null,
			accountLabel: null,
			fromRepositoryConfig: true,
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
	const form = resolveInfisicalLinkForm({
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
	const form = resolveInfisicalLinkForm({
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
	const form = resolveInfisicalLinkForm({
		draft: { ...EMPTY_INFISICAL_DRAFT, secretPath: '  /backend/  ' },
		link: savedLink({ secretPath: '/backend' }),
		projects: [backend],
		projectsLoaded: true,
	});

	expect(form.isDirty).toBe(false);
});

test('normalizeSecretPath roots the path and drops trailing slashes', () => {
	expect(normalizeSecretPath('')).toBe('/');
	expect(normalizeSecretPath('   ')).toBe('/');
	expect(normalizeSecretPath('backend')).toBe('/backend');
	expect(normalizeSecretPath('/backend/')).toBe('/backend');
	expect(normalizeSecretPath('/backend/api//')).toBe('/backend/api');
});
