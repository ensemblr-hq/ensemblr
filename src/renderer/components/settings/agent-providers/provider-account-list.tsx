import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';

import type { AgentProviderAccountWire } from '@/shared/ipc/contracts/agent-provider';

/**
 * Row labels for the account table.
 * @param t - Translation function from `useTranslation`
 * @returns The label for every account field
 */
function accountFieldLabels(
	t: TFunction,
): Record<keyof AgentProviderAccountWire, string> {
	return {
		apiProvider: t('settings:providers.account.api-provider', 'API provider'),
		email: t('settings:providers.account.email', 'Account'),
		organization: t('settings:providers.account.organization', 'Organization'),
		subscriptionType: t('settings:providers.account.plan', 'Plan'),
		tokenSource: t(
			'settings:providers.account.credential-source',
			'Credential source',
		),
	};
}

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
	const { t } = useTranslation();
	const labels = accountFieldLabels(t);
	const populated = ACCOUNT_FIELD_ORDER.filter(
		(field) => account[field] !== null && account[field] !== '',
	);

	if (populated.length === 0) {
		return (
			<p className='text-muted-foreground text-xs'>
				{t(
					'settings:providers.account.empty',
					'The provider reported no account details.',
				)}
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
						{labels[field]}
					</span>
					<span className='min-w-0 truncate font-mono text-foreground text-xs'>
						{account[field]}
					</span>
				</li>
			))}
		</ul>
	);
}
