import { useAtom } from 'jotai';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { AgentProviderLogo } from '@/renderer/components/agent-provider-brand';
import {
	Combobox,
	ComboboxChip,
	ComboboxChips,
	ComboboxChipsInput,
	ComboboxContent,
	ComboboxEmpty,
	ComboboxItem,
	ComboboxList,
	useComboboxAnchor,
} from '@/renderer/components/ui/combobox';
import { cn } from '@/renderer/lib/utils';
import { getProviderDisplayName } from '@/renderer/lib/workbench/model-picker-groups';
import { modelRoleAssignmentsAtom } from '@/renderer/state/preferences';
import { getAgentProviderLabel } from '@/shared/agent-provider';
import type { AgentModelOption } from '@/shared/ipc/contracts/agent-models';
import { assignedRolesFor, type ModelRole } from '@/shared/model-role';

/** One delegation role and its searchable, runtime-aware model chips. */
export function ModelRolePicker({
	description,
	models,
	name,
	role,
}: {
	description: string;
	models: readonly AgentModelOption[];
	name: string;
	role: ModelRole;
}) {
	const { t } = useTranslation();
	const id = useId();
	const anchor = useComboboxAnchor();
	const [assignments, setAssignments] = useAtom(modelRoleAssignmentsAtom);
	const selected = models.filter((model) =>
		assignedRolesFor(assignments, model.agentProvider, model.id).includes(role),
	);

	/**
	 * Updates only this role on active models, preserving other roles and unavailable pairs.
	 * @param chosen - Models selected in this role's chips input.
	 */
	function changeModels(chosen: AgentModelOption[]) {
		const chosenPairs = new Set(
			chosen.map((model) => `${model.agentProvider}:${model.id}`),
		);
		const activePairs = new Set(
			models.map((model) => `${model.agentProvider}:${model.id}`),
		);
		setAssignments((current) => [
			...current.flatMap((assignment) => {
				const pair = `${assignment.runtime}:${assignment.modelId}`;
				if (chosenPairs.has(pair)) return [];
				if (!activePairs.has(pair)) return [assignment];
				const roles = assignment.roles.filter((assigned) => assigned !== role);
				return roles.length ? [{ ...assignment, roles }] : [];
			}),
			...chosen.map((model) => ({
				modelId: model.id,
				roles: [
					...new Set([
						...assignedRolesFor(current, model.agentProvider, model.id),
						role,
					]),
				],
				runtime: model.agentProvider,
			})),
		]);
	}

	return (
		<div className='grid @lg:grid-cols-[12rem_minmax(0,1fr)] items-start @lg:gap-4 gap-3 py-4 first:pt-1 last:pb-1'>
			<div className='min-w-0 space-y-1'>
				<label className='font-medium text-foreground text-sm' htmlFor={id}>
					{name}
				</label>
				<p
					className='text-pretty text-muted-foreground text-xs leading-relaxed'
					id={`${id}-description`}
				>
					{description}
				</p>
			</div>
			<Combobox
				autoHighlight
				filter={(model, query) =>
					[
						model.displayName,
						model.id,
						model.vendor,
						getProviderDisplayName(model.vendor),
						getAgentProviderLabel(model.agentProvider),
					]
						.join(' ')
						.toLocaleLowerCase()
						.includes(query.trim().toLocaleLowerCase())
				}
				isItemEqualToValue={(model, value) =>
					model.agentProvider === value.agentProvider && model.id === value.id
				}
				itemToStringLabel={(model) => model.displayName}
				items={models}
				multiple
				onValueChange={(chosen, details) => {
					if (details.reason !== 'escape-key') changeModels(chosen);
				}}
				value={selected}
			>
				<ComboboxChips className='min-h-9 min-w-0 gap-1' ref={anchor}>
					{selected.map((model) => (
						<ComboboxChip
							className='h-6 max-w-full gap-1.5 rounded-md'
							key={`${model.agentProvider}:${model.id}`}
							removeLabel={t(
								'settings:models.orchestration.remove-model',
								'Remove {{model}} ({{runtime}}) from {{role}}',
								{
									model: model.displayName,
									runtime: getAgentProviderLabel(model.agentProvider),
									role: name,
								},
							)}
							title={`${model.displayName} · ${getAgentProviderLabel(model.agentProvider)} · ${getProviderDisplayName(model.vendor)} · ${model.id}`}
						>
							<AgentProviderLogo
								className='size-3 shrink-0 text-muted-foreground'
								provider={model.agentProvider}
							/>
							<span className='min-w-0 truncate'>{model.displayName}</span>
						</ComboboxChip>
					))}
					<ComboboxChipsInput
						aria-describedby={`${id}-description`}
						aria-label={t(
							'settings:models.orchestration.role-models-aria-label',
							'Models for {{role}}',
							{ role: name },
						)}
						className={cn(
							'h-6 text-xs placeholder:text-muted-foreground',
							selected.length > 0
								? 'w-12 min-w-12 basis-12'
								: 'w-full basis-full',
						)}
						id={id}
						placeholder={
							selected.length > 0
								? undefined
								: t(
										'settings:models.orchestration.search-placeholder',
										'Search models, runtimes, providers…',
									)
						}
					/>
				</ComboboxChips>
				<ComboboxContent anchor={anchor}>
					<ComboboxEmpty>
						{t(
							'settings:models.orchestration.no-matches',
							'No matching models.',
						)}
					</ComboboxEmpty>
					<ComboboxList>
						{(model: AgentModelOption) => (
							<ComboboxItem
								aria-label={`${model.displayName} · ${getAgentProviderLabel(model.agentProvider)} · ${getProviderDisplayName(model.vendor)}`}
								className='gap-2.5 rounded-md py-2 pl-2'
								key={`${model.agentProvider}:${model.id}`}
								title={`${getAgentProviderLabel(model.agentProvider)} · ${getProviderDisplayName(model.vendor)} · ${model.id}`}
								value={model}
							>
								<AgentProviderLogo
									className='size-4 shrink-0 text-muted-foreground'
									provider={model.agentProvider}
								/>
								<div className='min-w-0 flex-1'>
									<div className='truncate font-medium text-xs'>
										{model.displayName}
									</div>
									<div className='truncate text-muted-foreground text-xs'>
										{getProviderDisplayName(model.vendor)}
									</div>
								</div>
							</ComboboxItem>
						)}
					</ComboboxList>
				</ComboboxContent>
			</Combobox>
		</div>
	);
}
