import { expect, test } from 'bun:test';

import {
	createLinearConnectionFixture,
	createLinearFailureFixture,
	createLinearIssueFixture,
} from '../../src/renderer/fixtures/linear';
import {
	deriveLinearGateState,
	describeLinearFailure,
	formatLinearIssueContext,
	getLinearPriorityLabel,
	isLinearDataStale,
	mapLinearIssuesToWorkspaceSources,
} from '../../src/renderer/lib/linear';

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

test('isLinearDataStale: respects the freshness window', () => {
	expect(isLinearDataStale(null, NOW)).toBe(true);
	expect(isLinearDataStale('2026-06-11T00:09:00.000Z', NOW)).toBe(false);
	expect(isLinearDataStale('2026-06-10T23:00:00.000Z', NOW)).toBe(true);
});

test('formatLinearIssueContext: renders identifier, title, url, and excerpt', () => {
	const context = formatLinearIssueContext(createLinearIssueFixture());

	expect(context).toContain('Linear issue THE-143:');
	expect(context).toContain('Linear OAuth PKCE and Token Lifecycle');
	expect(context).toContain('https://linear.app/acme/issue/THE-143');
	expect(context).toContain('Implement OAuth PKCE login');
});

test('formatLinearIssueContext: omits the excerpt without a description', () => {
	const context = formatLinearIssueContext(
		createLinearIssueFixture({ description: null }),
	);

	expect(context).toBe(
		'Linear issue THE-143: Linear OAuth PKCE and Token Lifecycle\nhttps://linear.app/acme/issue/THE-143',
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
			identifier: 'THE-150',
			stateName: null,
			title: 'Terminal polish',
		}),
	]);

	expect(sources).toEqual([
		{
			id: 'issue-1',
			kind: 'issue',
			provider: 'linear',
			reference: 'THE-143',
			subtitle: 'Todo',
			title: 'Linear OAuth PKCE and Token Lifecycle',
		},
		{
			id: 'issue-2',
			kind: 'issue',
			provider: 'linear',
			reference: 'THE-150',
			subtitle: undefined,
			title: 'Terminal polish',
		},
	]);
});
