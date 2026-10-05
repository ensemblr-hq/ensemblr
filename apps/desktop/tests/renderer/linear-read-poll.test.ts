import { expect, test } from 'vitest';
import { linearReadPollInterval } from '../../src/renderer/api/ensemblr/linear';
import type {
	LinearServiceFailure,
	ListLinearIssuesResult,
} from '../../src/shared/ipc/contracts/linear';
import { createLinearFailureFixture } from '../fixtures/linear';

/**
 * A cached list answer naming one account's failure.
 * @param failure - The failure that account reported
 * @param syncing - Whether a refresh was still running behind the answer
 * @returns The list answer
 */
function partialAnswer(
	failure: LinearServiceFailure,
	syncing = false,
): ListLinearIssuesResult {
	return {
		accountFailures: [
			{ accountId: 'account-1', failure, organizationName: 'Acme' },
		],
		issues: [],
		source: 'cache',
		status: 'ok',
		...(syncing ? { syncing } : {}),
	};
}

test('nothing to poll before an answer arrives or once it is complete', () => {
	expect(linearReadPollInterval(undefined)).toBe(false);
	expect(
		linearReadPollInterval({
			accountFailures: [],
			issues: [],
			source: 'remote',
			status: 'ok',
		}),
	).toBe(false);
});

test('polls quickly while a refresh runs behind a cached answer', () => {
	expect(
		linearReadPollInterval(partialAnswer(createLinearFailureFixture(), true)),
	).toBe(1200);
});

test('keeps re-reading an answer whose failure can clear on its own', () => {
	expect(
		linearReadPollInterval(partialAnswer(createLinearFailureFixture())),
	).toBe(30_000);
	expect(
		linearReadPollInterval(
			partialAnswer(createLinearFailureFixture({ code: 'rate-limited' })),
		),
	).toBe(30_000);
	expect(
		linearReadPollInterval({
			accountFailures: [],
			failure: createLinearFailureFixture(),
			issues: [],
			status: 'error',
		}),
	).toBe(30_000);
});

test('stops polling on a failure only the user can fix', () => {
	expect(
		linearReadPollInterval(
			partialAnswer(createLinearFailureFixture({ code: 'reconnect-required' })),
		),
	).toBe(false);
	expect(
		linearReadPollInterval({
			accountFailures: [],
			failure: createLinearFailureFixture({ code: 'not-connected' }),
			issues: [],
			status: 'error',
		}),
	).toBe(false);
});
