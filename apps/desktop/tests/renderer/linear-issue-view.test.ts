import { expect, test } from 'vitest';
import {
	deriveLinearGateState,
	describeLinearAccountFailures,
	describeLinearFailure,
	formatLinearIssueContext,
	getLinearPriorityLabel,
	isLinearDataStale,
	isTransientLinearFailure,
	mapLinearIssuesToWorkspaceSources,
} from '../../src/renderer/lib/linear';
import type { LinearAccountFailure } from '../../src/shared/ipc/contracts/linear';
import {
	createLinearConnectionFixture,
	createLinearFailureFixture,
	createLinearIssueFixture,
} from '../fixtures/linear';

const NOW = new Date('2026-06-11T00:10:00.000Z');

test('deriveLinearGateState: loading while the connection query is in flight', () => {
	expect(
		deriveLinearGateState({ connection: undefined, isLoading: true }),
	).toEqual({ kind: 'loading' });
	expect(
		deriveLinearGateState({ connection: undefined, isLoading: false }),
	).toEqual({ kind: 'loading' });
});

test('deriveLinearGateState: maps every connection state', () => {
	expect(
		deriveLinearGateState({
			connection: createLinearConnectionFixture(),
			isLoading: false,
		}),
	).toEqual({ kind: 'ready' });
	expect(
		deriveLinearGateState({
			connection: createLinearConnectionFixture({ state: 'disconnected' }),
			isLoading: false,
		}),
	).toEqual({ kind: 'disconnected' });
	expect(
		deriveLinearGateState({
			connection: createLinearConnectionFixture({ state: 'not-configured' }),
			isLoading: false,
		}),
	).toEqual({ kind: 'not-configured' });
	expect(
		deriveLinearGateState({
			connection: createLinearConnectionFixture({
				state: 'reconnect-required',
			}),
			isLoading: false,
		}),
	).toEqual({ kind: 'reconnect-required' });
});

test('getLinearPriorityLabel: maps Linear priority numbers', () => {
	expect(getLinearPriorityLabel(null)).toBe('No priority');
	expect(getLinearPriorityLabel(0)).toBe('No priority');
	expect(getLinearPriorityLabel(1)).toBe('Urgent');
	expect(getLinearPriorityLabel(4)).toBe('Low');
	expect(getLinearPriorityLabel(99)).toBe('No priority');
});

test('describeLinearFailure: includes the retry hint for rate limits', () => {
	expect(
		describeLinearFailure(
			createLinearFailureFixture({
				code: 'rate-limited',
				retryAfterSeconds: 42,
			}),
		),
	).toContain('42s');
	expect(
		describeLinearFailure(createLinearFailureFixture({ code: 'rate-limited' })),
	).toContain('shortly');
});

test('describeLinearFailure: produces actionable copy per failure code', () => {
	expect(
		describeLinearFailure(
			createLinearFailureFixture({ code: 'not-connected' }),
		),
	).toContain('integration settings');
	expect(
		describeLinearFailure(
			createLinearFailureFixture({ code: 'permission-denied' }),
		),
	).toContain('permission');
	expect(
		describeLinearFailure(createLinearFailureFixture({ code: 'not-found' })),
	).toContain('no longer exists');
	expect(
		describeLinearFailure(createLinearFailureFixture({ code: 'network' })),
	).toContain('cached');
});

/**
 * One organization's failure inside a merged read.
 * @param organizationName - Organization the account signs into
 * @param failure - Overrides for the failure it reported
 * @returns The per-account failure
 */
function accountFailure(
	organizationName: string,
	failure: Parameters<typeof createLinearFailureFixture>[0] = {},
): LinearAccountFailure {
	return {
		accountId: `account-${organizationName}`,
		failure: createLinearFailureFixture(failure),
		organizationName,
	};
}

test('describeLinearAccountFailures: names every organization that failed the same way once', () => {
	expect(
		describeLinearAccountFailures([
			accountFailure('The Swiss Cheese'),
			accountFailure('Almost Always'),
		]),
	).toBe(
		'Could not reach Linear for The Swiss Cheese and Almost Always. Showing cached data where available.',
	);
});

test('describeLinearAccountFailures: gives each distinct reason its own sentence', () => {
	expect(
		describeLinearAccountFailures([
			accountFailure('The Swiss Cheese'),
			accountFailure('Almost Always', { code: 'reconnect-required' }),
			accountFailure('Acme'),
		]),
	).toBe(
		'Could not reach Linear for The Swiss Cheese and Acme. Showing cached data where available. The Linear connection for Almost Always expired. Reconnect from integration settings.',
	);
});

test('describeLinearAccountFailures: waits out the longest rate-limit window', () => {
	expect(
		describeLinearAccountFailures([
			accountFailure('The Swiss Cheese', {
				code: 'rate-limited',
				retryAfterSeconds: 12,
			}),
			accountFailure('Almost Always', {
				code: 'rate-limited',
				retryAfterSeconds: 40,
			}),
		]),
	).toBe(
		'Linear is rate-limiting The Swiss Cheese and Almost Always. Try again in 40s.',
	);
});

test('describeLinearAccountFailures: falls back to the account id for an unnamed organization', () => {
	expect(
		describeLinearAccountFailures([
			{
				accountId: 'account-1',
				failure: createLinearFailureFixture(),
				organizationName: null,
			},
		]),
	).toContain('for account-1.');
});

test('isTransientLinearFailure: only the network and rate limits clear on their own', () => {
	expect(isTransientLinearFailure(createLinearFailureFixture())).toBe(true);
	expect(
		isTransientLinearFailure(
			createLinearFailureFixture({ code: 'rate-limited' }),
		),
	).toBe(true);
	expect(
		isTransientLinearFailure(
			createLinearFailureFixture({ code: 'reconnect-required' }),
		),
	).toBe(false);
	expect(
		isTransientLinearFailure(
			createLinearFailureFixture({ code: 'permission-denied' }),
		),
	).toBe(false);
});

test('isLinearDataStale: respects the freshness window', () => {
	expect(isLinearDataStale(null, NOW)).toBe(true);
	expect(isLinearDataStale('2026-06-11T00:09:00.000Z', NOW)).toBe(false);
	expect(isLinearDataStale('2026-06-10T23:00:00.000Z', NOW)).toBe(true);
});

test('formatLinearIssueContext: renders identifier, title, url, and excerpt', () => {
	const context = formatLinearIssueContext(createLinearIssueFixture());

	expect(context).toContain('Linear issue ENG-143:');
	expect(context).toContain('Linear OAuth PKCE and Token Lifecycle');
	expect(context).toContain('https://linear.app/acme/issue/ENG-143');
	expect(context).toContain('Implement OAuth PKCE login');
});

test('formatLinearIssueContext: omits the excerpt without a description', () => {
	const context = formatLinearIssueContext(
		createLinearIssueFixture({ description: null }),
	);

	expect(context).toBe(
		'Linear issue ENG-143: Linear OAuth PKCE and Token Lifecycle\nhttps://linear.app/acme/issue/ENG-143',
	);
});

test('formatLinearIssueContext: truncates very long descriptions', () => {
	const context = formatLinearIssueContext(
		createLinearIssueFixture({ description: 'x'.repeat(2000) }),
	);

	expect(context.length).toBeLessThan(800);
	expect(context.endsWith('…')).toBe(true);
});

test('mapLinearIssuesToWorkspaceSources: produces linear issue picker sources', () => {
	const sources = mapLinearIssuesToWorkspaceSources([
		createLinearIssueFixture(),
		createLinearIssueFixture({
			id: 'issue-2',
			identifier: 'ENG-150',
			stateName: null,
			title: 'Terminal polish',
		}),
	]);

	expect(sources).toEqual([
		{
			id: 'issue-1',
			kind: 'issue',
			provider: 'linear',
			reference: 'ENG-143',
			subtitle: 'Todo',
			title: 'Linear OAuth PKCE and Token Lifecycle',
			trackerProject: 'Ensemblr',
		},
		{
			id: 'issue-2',
			kind: 'issue',
			provider: 'linear',
			reference: 'ENG-150',
			subtitle: undefined,
			title: 'Terminal polish',
			trackerProject: 'Ensemblr',
		},
	]);
});

test('mapLinearIssuesToWorkspaceSources: leaves trackerProject off an issue in no project', () => {
	const [source] = mapLinearIssuesToWorkspaceSources([
		createLinearIssueFixture({ projectId: null, projectName: null }),
	]);

	expect(source).not.toHaveProperty('trackerProject');
});
