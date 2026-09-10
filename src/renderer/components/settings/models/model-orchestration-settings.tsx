import { Link } from '@tanstack/react-router';
import { useAtom } from 'jotai';
import { useTranslation } from 'react-i18next';

import { ModelRoleAssignmentsSetting } from '@/renderer/components/settings/models/model-role-assignments-setting';
import { SettingRow } from '@/renderer/components/settings/setting-row';
import { buttonVariants } from '@/renderer/components/ui/button';
import { Switch } from '@/renderer/components/ui/switch';
import { allowCrossRuntimeDelegationAtom } from '@/renderer/state/preferences';
import type { AgentModelOption } from '@/shared/ipc/contracts/agent-models';

/** Cross-runtime policy, role assignments, and the Claude delegation-mode link. */
export function ModelOrchestrationSettings({
	error,
	isLoading,
	models,
}: {
	error: Error | null;
	isLoading: boolean;
	models: readonly AgentModelOption[];
}) {
	const { t } = useTranslation();
	const [allowCrossRuntime, setAllowCrossRuntime] = useAtom(
		allowCrossRuntimeDelegationAtom,
	);
	return (
		<>
			<SettingRow
				control={
					<Switch
						aria-label={t(
							'settings:models.orchestration.cross-runtime.aria-label',
							'Allow cross-runtime delegation',
						)}
						checked={allowCrossRuntime}
						onCheckedChange={setAllowCrossRuntime}
					/>
				}
				description={t(
					'settings:models.orchestration.cross-runtime.description',
					'Lets Ensemblr-managed children explicitly run on another configured runtime and model provider. Omitted models still inherit the caller’s runtime. Filesystem permissions and cost approvals do not change.',
				)}
				label={t(
					'settings:models.orchestration.cross-runtime.label',
					'Allow cross-runtime delegation',
				)}
			/>

			<ModelRoleAssignmentsSetting
				error={error}
				isLoading={isLoading}
				models={models}
			/>

			<SettingRow
				control={
					<Link
						className={buttonVariants({ size: 'sm', variant: 'outline' })}
						to='/settings/providers'
					>
						{t(
							'settings:models.orchestration.claude-native.action',
							'Open Providers',
						)}
					</Link>
				}
				description={t(
					'settings:models.orchestration.claude-native.description',
					'Claude Code’s built-in sub-agents bypass Ensemblr delegation and cannot use these role preferences or cross-runtime routing. Choose Ensemblr chat tabs for new Claude chats to use this feature.',
				)}
				label={t(
					'settings:models.orchestration.claude-native.label',
					'Claude Code delegation',
				)}
			/>
		</>
	);
}
