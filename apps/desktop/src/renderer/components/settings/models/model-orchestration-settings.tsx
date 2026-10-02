import { Link } from '@tanstack/react-router';
import { useAtom } from 'jotai';
import { useTranslation } from 'react-i18next';

import { DelegationInitiativeRow } from '@/renderer/components/settings/models/delegation-initiative-row';
import { ModelRoleAssignmentsSetting } from '@/renderer/components/settings/models/model-role-assignments-setting';
import { SettingRow } from '@/renderer/components/settings/setting-row';
import { buttonVariants } from '@/renderer/components/ui/button';
import { Switch } from '@/renderer/components/ui/switch';
import { allowCrossRuntimeDelegationAtom } from '@/renderer/state/preferences';
import type { AgentModelOption } from '@/shared/ipc/contracts/agent-models';

/**
 * The delegation half of the Models screen, headed so it reads apart from the
 * model-slot rows above it: when agents delegate, across which runtimes, with
 * which role preferences, and through which mechanism on Claude Code.
 *
 * The group owns its own `divide-y` because wrapping the rows makes them one
 * child of the section's list, and it draws no top border of its own because
 * that same list already separates it from the row above.
 */
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
		<div className='space-y-3 pt-5'>
			<div className='space-y-1'>
				<h2 className='font-medium text-foreground text-sm'>
					{t('settings:models.orchestration.group.title', 'Delegation')}
				</h2>
				<p className='max-w-prose text-pretty text-muted-foreground text-xs leading-relaxed'>
					{t(
						'settings:models.orchestration.group.description',
						'How agents hand work to one another: when they may delegate, which runtimes they may reach, and which model suits which kind of task.',
					)}
				</p>
			</div>

			<div className='divide-y divide-border'>
				<DelegationInitiativeRow />

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
			</div>
		</div>
	);
}
