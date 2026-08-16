import type { LinearConnectionSummary } from '../../shared/ipc/contracts/linear';
import type {
	SetupCheckStatus,
	SetupRemediationAction,
} from '../../shared/ipc/contracts/setup';
import type { LinearAuthService } from '../linear';
import {
	authoredDetail,
	defineCheck,
	type SetupCheckProviderContext,
	unexpectedErrorDetail,
} from './setup-check-context.ts';

/** Dependencies for the Linear setup check. */
interface LinearCheckDeps {
	context: SetupCheckProviderContext;
	linearAuthService: LinearAuthService;
}

const LINEAR_REMEDIATION_ACTIONS: SetupRemediationAction[] = [
	{
		id: 'open-linear-settings',
		kind: 'open-settings',
		label: 'Open integration settings',
		target: 'linear',
	},
	{
		id: 'retry-linear',
		kind: 'retry',
		label: 'Retry Linear check',
	},
];

/** Builds the snapshot for the optional Linear OAuth connection check. */
export function getLinearConnectionCheck(deps: LinearCheckDeps) {
	const check = defineCheck<SetupCheckProviderContext>({
		blocking: false,
		description:
			'Reports the Linear OAuth connection used by issue browsing, issue workflows, and workspace creation from issues.',
		group: 'linear',
		id: 'linear-oauth',
		onError: (error) => ({
			...unexpectedErrorDetail(error, {
				code: 'linear-unknown-error',
				text: 'Unknown Linear check error.',
			}),
			remediationActions: LINEAR_REMEDIATION_ACTIONS,
			status: 'warning',
		}),
		run: async () => {
			const summary = await deps.linearAuthService.getConnectionSummary();

			return {
				...describeConnection(summary),
				remediationActions: LINEAR_REMEDIATION_ACTIONS,
				status: statusForConnection(summary),
			};
		},
		title: 'Linear connection',
	});

	return check(deps.context);
}

/**
 * Map a Linear connection summary to a setup-check status.
 * @param summary - Current Linear connection summary
 * @returns `'success'` when at least one account is connected, otherwise `'warning'`
 */
function statusForConnection(
	summary: LinearConnectionSummary,
): SetupCheckStatus {
	return summary.state === 'connected' ? 'success' : 'warning';
}

/**
 * Build the user-facing detail describing the Linear connection state. Several
 * accounts may be connected, so the multi-account case names the organizations
 * rather than picking one to report.
 * @param summary - Current Linear connection summary
 * @returns The detail fields for the check result
 */
function describeConnection(summary: LinearConnectionSummary) {
	switch (summary.state) {
		case 'connected':
			return describeConnectedAccounts(
				summary.accounts.filter((account) => account.state === 'connected'),
			);
		case 'not-configured':
			return authoredDetail(
				'linear-not-configured',
				'Linear OAuth is not configured. Add app.linear.clientId to the Ensemblr config to enable Linear workflows. Linear is optional for local and GitHub-only workflows.',
			);
		case 'reconnect-required':
			return authoredDetail(
				'linear-reconnect-required',
				'Every connected Linear account has an expired token that cannot be refreshed. Reconnect from integration settings.',
			);
		default:
			return authoredDetail(
				'linear-not-connected',
				'No Linear account is connected. Sign in from integration settings to enable Linear workflows.',
			);
	}
}

/**
 * Describe the accounts that are working. Several are named as a count plus
 * their organizations; one is named the way it always was, so the common case
 * reads no differently than before multi-account.
 * @param accounts - Accounts whose own state is `connected`
 * @returns The detail fields for the check result
 */
function describeConnectedAccounts(
	accounts: LinearConnectionSummary['accounts'],
) {
	if (accounts.length > 1) {
		const organizations = organizationList(accounts);

		return authoredDetail(
			'linear-connected-accounts',
			`Linear is connected to ${accounts.length} accounts (${organizations}).`,
			{ count: String(accounts.length), organizations },
		);
	}

	const account = accounts[0];
	const identity = account?.userName ?? account?.userEmail;
	const organization = account?.organizationName;

	if (identity && organization) {
		return authoredDetail(
			'linear-connected-with-organization',
			`Linear is connected as ${identity} (${organization}).`,
			{ identity, organization },
		);
	}

	return identity
		? authoredDetail(
				'linear-connected-as',
				`Linear is connected as ${identity}.`,
				{ identity },
			)
		: authoredDetail('linear-connected', 'Linear is connected.');
}

/**
 * Render an account list as a readable organization enumeration. An account
 * Linear named neither an organization nor an identity for is left out rather
 * than listed by id: the id is a UUID that tells the reader nothing, and the
 * count beside the list already accounts for it.
 * @param accounts - Connected accounts to name
 * @returns The comma-separated organization names
 */
function organizationList(
	accounts: LinearConnectionSummary['accounts'],
): string {
	return accounts
		.map(
			(account) =>
				account.organizationName ?? account.userName ?? account.userEmail,
		)
		.filter((name): name is string => name !== null && name !== undefined)
		.join(', ');
}
