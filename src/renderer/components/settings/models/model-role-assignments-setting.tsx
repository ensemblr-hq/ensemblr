import { useAtom, useAtomValue } from 'jotai';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ModelRolePicker } from '@/renderer/components/settings/models/model-role-picker';
import { SettingRow } from '@/renderer/components/settings/setting-row';
import {
	SettingsErrorState,
	SettingsLoadingState,
} from '@/renderer/components/settings/settings-async-state';
import { SettingsEmptyState } from '@/renderer/components/settings/settings-empty-state';
import { Button } from '@/renderer/components/ui/button';
import {
	hiddenModelsAtom,
	modelOrchestrationWriteErrorAtom,
	modelRoleAssignmentsAtom,
} from '@/renderer/state/preferences';
import { getAgentProviderLabel } from '@/shared/agent-provider';
import type { AgentModelOption } from '@/shared/ipc/contracts/agent-models';
import {
	assignedRolesFor,
	MODEL_ROLES,
	type ModelRole,
	type ModelRoleAssignment,
} from '@/shared/model-role';

/** Localized name and definition for one advisory model role. */
interface ModelRoleCopy {
	description: string;
	name: string;
}

/** Displays unavailable assignments without treating them as active destinations. */
function UnavailableRoleAssignments({
	assignments,
	copy,
	setAssignments,
}: {
	assignments: readonly ModelRoleAssignment[];
	copy: Record<ModelRole, ModelRoleCopy>;
	setAssignments: (
		update: (current: ModelRoleAssignment[]) => ModelRoleAssignment[],
	) => void;
}) {
	const { t } = useTranslation();
	if (assignments.length === 0) return null;
	return (
		<div className='space-y-2'>
			<p className='font-medium text-foreground text-xs'>
				{t(
					'settings:models.orchestration.unavailable.title',
					'Unavailable saved assignments',
				)}
			</p>
			<p className='text-muted-foreground text-xs'>
				{t(
					'settings:models.orchestration.unavailable.description',
					'These models are hidden or were not reported by discovery. Their roles remain saved until you clear them.',
				)}
			</p>
			<ul className='divide-y divide-border rounded-xl border border-border'>
				{assignments.map((assignment) => (
					<li
						className='flex items-center justify-between gap-3 px-3 py-2'
						key={`${assignment.runtime}:${assignment.modelId}`}
					>
						<div className='min-w-0'>
							<div className='truncate font-mono text-foreground text-xs'>
								{assignment.modelId}
							</div>
							<div className='truncate text-muted-foreground text-xs'>
								{getAgentProviderLabel(assignment.runtime)}
								{' · '}
								{assignedRolesFor(
									assignments,
									assignment.runtime,
									assignment.modelId,
								)
									.map((role) => copy[role].name)
									.join(', ')}
							</div>
						</div>
						<Button
							aria-label={t(
								'settings:models.orchestration.unavailable.clear-aria-label',
								'Clear roles for {{model}}',
								{ model: assignment.modelId },
							)}
							onClick={() =>
								setAssignments((current) =>
									current.filter(
										(entry) =>
											entry.runtime !== assignment.runtime ||
											entry.modelId !== assignment.modelId,
									),
								)
							}
							size='xs'
							variant='ghost'
						>
							{t('settings:models.orchestration.unavailable.clear', 'Clear')}
						</Button>
					</li>
				))}
			</ul>
		</div>
	);
}

/** Five role-centered model pickers, with discovery and saved-assignment recovery states. */
export function ModelRoleAssignmentsSetting({
	error,
	isLoading,
	models,
}: {
	error: Error | null;
	isLoading: boolean;
	models: readonly AgentModelOption[];
}) {
	const { t } = useTranslation();
	const [assignments, setAssignments] = useAtom(modelRoleAssignmentsAtom);
	const hiddenModels = useAtomValue(hiddenModelsAtom);
	const writeError = useAtomValue(modelOrchestrationWriteErrorAtom);
	const copy = {
		sage: {
			description: t(
				'settings:models.orchestration.roles.sage.description',
				'Reasoning, architecture, and difficult tradeoffs',
			),
			name: t('settings:models.orchestration.roles.sage.name', 'Sage'),
		},
		coder: {
			description: t(
				'settings:models.orchestration.roles.coder.description',
				'Novel code with unresolved design choices',
			),
			name: t('settings:models.orchestration.roles.coder.name', 'Coder'),
		},
		builder: {
			description: t(
				'settings:models.orchestration.roles.builder.description',
				'Routine implementation from an established pattern',
			),
			name: t('settings:models.orchestration.roles.builder.name', 'Builder'),
		},
		grunt: {
			description: t(
				'settings:models.orchestration.roles.grunt.description',
				'Mechanical work; no judgment required',
			),
			name: t('settings:models.orchestration.roles.grunt.name', 'Grunt'),
		},
		explorer: {
			description: t(
				'settings:models.orchestration.roles.explorer.description',
				'Read-only investigation and planning',
			),
			name: t('settings:models.orchestration.roles.explorer.name', 'Explorer'),
		},
	} satisfies Record<ModelRole, ModelRoleCopy>;
	const activeModels = useMemo(() => {
		const hidden = new Set(hiddenModels);
		return models.filter((model) => !hidden.has(model.id));
	}, [hiddenModels, models]);
	const unavailableAssignments = useMemo(() => {
		const activePairs = new Set(
			activeModels.map((model) => `${model.agentProvider}:${model.id}`),
		);
		const seenPairs = new Set<string>();
		const unavailable: ModelRoleAssignment[] = [];
		for (const assignment of assignments) {
			const pair = `${assignment.runtime}:${assignment.modelId}`;
			if (
				assignment.roles.length === 0 ||
				activePairs.has(pair) ||
				seenPairs.has(pair)
			) {
				continue;
			}
			seenPairs.add(pair);
			unavailable.push(assignment);
		}
		return unavailable;
	}, [activeModels, assignments]);

	return (
		<SettingRow
			label={t('settings:models.orchestration.roles.label', 'Delegation roles')}
			stack
		>
			<div className='@container space-y-4'>
				{writeError ? (
					<div aria-live='polite'>
						<SettingsErrorState
							className='py-0'
							message={t(
								'settings:models.orchestration.save-failed',
								'Could not save model orchestration settings. Your latest change may not be saved.',
							)}
						/>
					</div>
				) : null}
				{isLoading ? (
					<SettingsLoadingState
						label={t('settings:models.loading', 'Loading models…')}
					/>
				) : error ? (
					<>
						<SettingsErrorState
							message={t(
								'settings:models.discovery-failed',
								'Model discovery failed: {{error}}.',
								{ error: String(error) },
							)}
						/>
						<UnavailableRoleAssignments
							assignments={unavailableAssignments}
							copy={copy}
							setAssignments={setAssignments}
						/>
					</>
				) : (
					<>
						{activeModels.length === 0 ? (
							<SettingsEmptyState
								description={t(
									'settings:models.orchestration.empty.description',
									'Configure a runtime or show a hidden model before assigning roles.',
								)}
								title={t(
									'settings:models.orchestration.empty.title',
									'No active delegation models',
								)}
							/>
						) : (
							<div className='divide-y divide-border'>
								{MODEL_ROLES.map((role) => (
									<ModelRolePicker
										description={copy[role].description}
										key={role}
										models={activeModels}
										name={copy[role].name}
										role={role}
									/>
								))}
							</div>
						)}
						<UnavailableRoleAssignments
							assignments={unavailableAssignments}
							copy={copy}
							setAssignments={setAssignments}
						/>
					</>
				)}
			</div>
		</SettingRow>
	);
}
