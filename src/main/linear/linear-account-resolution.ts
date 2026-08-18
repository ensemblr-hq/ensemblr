import type { LinearAccountSnapshot } from '../../shared/ipc/contracts/linear';
import { type LinearClient, LinearServiceError } from './linear-client.ts';
import type { LinearStore } from './linear-store.ts';
import type { AccountTarget } from './linear-wire.ts';

/** How a write names the single account it belongs to. */
export interface ResolveTargetOptions {
	accountId: string | undefined;
	describe: string;
	fallbackAccountId?: string | undefined;
	locate: () => string | null;
}

/** Resolves which connected Linear account an operation acts on. */
export interface LinearAccountResolver {
	locateIssueAccount: (
		store: LinearStore,
		accounts: LinearAccountSnapshot[],
		issueId: string,
	) => string | null;
	resolveTarget: (options: ResolveTargetOptions) => Promise<AccountTarget>;
	resolveTargets: (accountId?: string) => Promise<AccountTarget[]>;
}

/** Options for {@link createLinearAccountResolver}. */
export interface CreateLinearAccountResolverOptions {
	clientFactory: (accountId: string) => LinearClient;
	listAccounts: () => Promise<LinearAccountSnapshot[]>;
}

/**
 * Builds the account resolver every Linear operation goes through. Several
 * organizations may be connected at once, so "which account" is a decision with
 * its own rules (ADR 0052) rather than a field the caller always knows.
 * @param options - Client factory and account lister.
 * @returns A fresh {@link LinearAccountResolver}.
 */
export function createLinearAccountResolver({
	clientFactory,
	listAccounts,
}: CreateLinearAccountResolverOptions): LinearAccountResolver {
	/**
	 * Resolve the accounts an operation reads from, refusing when Linear has no
	 * connected account at all or when a named one is unknown.
	 * @param accountId - Account to narrow to, or undefined to read every account.
	 * @returns The accounts to operate on, each with its own client.
	 */
	async function resolveTargets(accountId?: string): Promise<AccountTarget[]> {
		const accounts = await listAccounts();

		if (accounts.length === 0) {
			throw new LinearServiceError(
				'not-connected',
				'No Linear account is connected. Connect one in Settings → Integrations.',
			);
		}

		const selected = accountId
			? accounts.filter((account) => account.id === accountId)
			: accounts;

		if (selected.length === 0) {
			throw new LinearServiceError(
				'invalid-request',
				`No connected Linear account has the id "${accountId}".`,
			);
		}

		return selected.map((account) => ({
			account,
			client: clientFactory(account.id),
		}));
	}

	/**
	 * Resolve the single account a write belongs to, in the order ADR 0052 fixes:
	 * the account named, the account owning the entity, the caller's fallback,
	 * then the only connected account. The fallback sits *after* the entity so a
	 * caller-supplied default can never mask an entity that names another account,
	 * nor pre-empt the refusal an ambiguous identifier is supposed to raise.
	 * @param options - The named account, the entity lookup, the caller's fallback, and how to describe the entity.
	 * @returns The resolved account with its client.
	 */
	async function resolveTarget(
		options: ResolveTargetOptions,
	): Promise<AccountTarget> {
		const { accountId, describe, fallbackAccountId, locate } = options;

		if (accountId) {
			const [target] = await resolveTargets(accountId);

			if (!target) {
				throw new LinearServiceError(
					'invalid-request',
					`No connected Linear account has the id "${accountId}".`,
				);
			}

			return target;
		}

		const located = locate() ?? fallbackAccountId ?? null;

		if (located) {
			return resolveTarget({
				accountId: located,
				describe,
				locate: () => null,
			});
		}

		const targets = await resolveTargets();

		if (targets.length === 1 && targets[0]) {
			return targets[0];
		}

		throw new LinearServiceError(
			'invalid-request',
			`${describe} is not in any connected account's cache, so the account could not be resolved. Name an accountId.`,
		);
	}

	return {
		locateIssueAccount: (store, accounts, issueId) => {
			const cached = store.getIssue(issueId);

			if (cached) {
				return cached.accountId;
			}

			const matches = accounts.filter((account) =>
				store.getIssueByIdentifier(account.id, issueId),
			);

			if (matches.length > 1) {
				throw new LinearServiceError(
					'invalid-request',
					`"${issueId}" matches an issue in ${matches.length} connected Linear accounts (${matches
						.map((account) => account.organizationName ?? account.id)
						.join(', ')}). Name an accountId.`,
				);
			}

			return matches[0]?.id ?? null;
		},

		resolveTarget,
		resolveTargets,
	};
}
