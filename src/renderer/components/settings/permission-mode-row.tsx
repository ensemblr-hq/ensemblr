import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';

import { SettingRow } from '@/renderer/components/settings/setting-row';
import { SourceBadge } from '@/renderer/components/settings/source-badge';
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/renderer/components/ui/select';
import type { SettingsResolutionSource } from '@/shared/ipc/contracts/settings-resolution';
import {
	isPermissionMode,
	PERMISSION_MODES,
	type PermissionMode,
} from '@/shared/permissions';

/**
 * Human-readable copy for each permission mode. Built from `t()` rather than a
 * module-scope table so a language change re-renders them and so
 * `i18next-cli extract` can see every key statically.
 * @param t - Translation function from `useTranslation`
 * @returns Label and description for every permission mode
 */
function permissionModeCopy(
	t: TFunction,
): Record<PermissionMode, { label: string; description: string }> {
	return {
		'approval-required': {
			description: t(
				'settings:repo.security.permission-mode.approval-required-description',
				'Every write, command, and app-control action asks you first.',
			),
			label: t(
				'settings:repo.security.permission-mode.approval-required',
				'Approval required',
			),
		},
		'read-only': {
			description: t(
				'settings:repo.security.permission-mode.read-only-description',
				'Agents may read the workspace but cannot write, run commands, or drive the app.',
			),
			label: t('settings:repo.security.permission-mode.read-only', 'Read only'),
		},
		'workspace-trusted': {
			description: t(
				'settings:repo.security.permission-mode.workspace-trusted-description',
				'Agents act freely inside the workspace; anything outside it still asks.',
			),
			label: t(
				'settings:repo.security.permission-mode.workspace-trusted',
				'Workspace trusted',
			),
		},
	};
}

/**
 * Picker for the agent permission mode a repository's workspaces run under.
 * Presentation only — the route owns reading the resolved value and persisting
 * the choice, so this renders from plain props and is testable on its own.
 */
export function PermissionModeRow({
	mode,
	onChange,
	onReset,
	source,
}: {
	mode: PermissionMode;
	onChange: (next: PermissionMode) => void;
	onReset: () => void;
	source: SettingsResolutionSource | undefined;
}) {
	const { t } = useTranslation();
	const copy = permissionModeCopy(t);

	return (
		<SettingRow
			control={
				<Select
					onValueChange={(next) => {
						if (isPermissionMode(next)) onChange(next);
					}}
					value={mode}
				>
					<SelectTrigger className='w-48' size='sm'>
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{PERMISSION_MODES.map((candidate) => (
							<SelectItem key={candidate} value={candidate}>
								{copy[candidate].label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			}
			description={copy[mode].description}
			label={
				<span className='flex items-center gap-2'>
					{t(
						'settings:repo.security.permission-mode.label',
						'Agent permission mode',
					)}
					<SourceBadge source={source} />
				</span>
			}
			modified={source === 'sqlite'}
			onReset={onReset}
		/>
	);
}
