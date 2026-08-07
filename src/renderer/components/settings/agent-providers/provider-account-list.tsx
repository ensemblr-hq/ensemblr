import type { AgentProviderAccountWire } from '@/shared/ipc/contracts/agent-provider';

/** Row labels for the account table, in display order. */
const ACCOUNT_FIELD_LABELS = {
	apiProvider: 'API provider',
	email: 'Account',
	organization: 'Organization',
	subscriptionType: 'Plan',
	tokenSource: 'Credential source',
} satisfies Record<keyof AgentProviderAccountWire, string>;

const ACCOUNT_FIELD_ORDER = [
	'email',
	'organization',
	'subscriptionType',
	'tokenSource',
	'apiProvider',
] as const satisfies readonly (keyof AgentProviderAccountWire)[];

/**
 * Key/value table for the signed-in provider account. Fields the provider does
 * not report are omitted rather than shown empty, so Pi (which reports no
 * account at all) and a Claude API-key session both read cleanly.
 */
export function ProviderAccountList({
	account,
}: {
	account: AgentProviderAccountWire;
}) {
	const populated = ACCOUNT_FIELD_ORDER.filter(
		(field) => account[field] !== null && account[field] !== '',
	);

	if (populated.length === 0) {
		return (
			<p className='text-muted-foreground text-xs'>
				The provider reported no account details.
			</p>
		);
	}

	return (
		<ul className='divide-y divide-border rounded-md border bg-card/40'>
			{populated.map((field) => (
				<li
					className='flex items-baseline justify-between gap-4 px-3 py-2'
					key={field}
				>
					<span className='shrink-0 text-muted-foreground text-xs'>
						{ACCOUNT_FIELD_LABELS[field]}
					</span>
					<span className='min-w-0 truncate font-mono text-foreground text-xs'>
						{account[field]}
					</span>
				</li>
			))}
		</ul>
	);
}
