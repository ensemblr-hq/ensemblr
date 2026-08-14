import { useTranslation } from 'react-i18next';

import { Badge } from '@/renderer/components/ui/badge';
import type { LinearConnectionSnapshot } from '@/shared/ipc/contracts/linear';

/** Badge showing the Linear connection state, or nothing while the snapshot is loading. */
export function LinearConnectionStateBadge({
	snapshot,
}: {
	snapshot: LinearConnectionSnapshot | undefined;
}) {
	const { t } = useTranslation();

	if (!snapshot) {
		return null;
	}

	switch (snapshot.state) {
		case 'connected':
			return (
				<Badge variant='secondary'>
					{t('settings:integrations.linear.state-connected', 'Connected')}
				</Badge>
			);
		case 'reconnect-required':
			return (
				<Badge variant='destructive'>
					{t(
						'settings:integrations.linear.state-reconnect',
						'Reconnect required',
					)}
				</Badge>
			);
		case 'not-configured':
			return (
				<Badge variant='outline'>
					{t(
						'settings:integrations.linear.state-not-configured',
						'Not configured',
					)}
				</Badge>
			);
		default:
			return (
				<Badge variant='outline'>
					{t('settings:integrations.linear.state-disconnected', 'Disconnected')}
				</Badge>
			);
	}
}
