import { useQuery } from '@tanstack/react-query';
import { PlusIcon } from 'lucide-react';
import { useMemo, useState } from 'react';

import { environmentVariablesQuery } from '@/renderer/api/ensemblr';
import { DocumentedVariablesList } from '@/renderer/components/settings/documented-variables-list';
import { EnvFilesSection } from '@/renderer/components/settings/env-files-section';
import { EnvironmentVariableRow } from '@/renderer/components/settings/environment-variable-row';
import {
	EnvironmentVariableSheet,
	type EnvironmentVariableSheetTarget,
} from '@/renderer/components/settings/environment-variable-sheet';
import { SettingsEmptyState } from '@/renderer/components/settings/settings-empty-state';
import { SettingsSection } from '@/renderer/components/settings/settings-section';
import { Button } from '@/renderer/components/ui/button';
import { Spinner } from '@/renderer/components/ui/spinner';
import type {
	EnvironmentVariableScope,
	EnvironmentVariableSnapshot,
} from '@/shared/ipc/contracts/environment';

interface EnvironmentVariablesPanelProps {
	scope: EnvironmentVariableScope;
	scopeId?: string;
	title: string;
	description: string;
	enableEnvFiles?: boolean;
}

/** A configured variable the user can directly set (plain or secret). */
function isConfigured(variable: EnvironmentVariableSnapshot): boolean {
	return variable.status === 'set' || variable.status === 'masked';
}

/** A settable catalog variable that is not yet configured. */
function isDocumentedUnset(variable: EnvironmentVariableSnapshot): boolean {
	return (
		variable.status === 'unset' &&
		!variable.catalog.reserved &&
		variable.catalog.category !== 'custom'
	);
}

/** Editable environment-variables screen: list, documented catalog, env files. */
export function EnvironmentVariablesPanel({
	description,
	enableEnvFiles = false,
	scope,
	scopeId,
	title,
}: EnvironmentVariablesPanelProps) {
	const { data, error, isLoading } = useQuery(environmentVariablesQuery);
	const [target, setTarget] = useState<EnvironmentVariableSheetTarget | null>(
		null,
	);

	const scoped = useMemo(
		() =>
			(data?.variables ?? []).filter(
				(variable) =>
					variable.scope === scope &&
					(!scopeId || variable.scopeId === scopeId),
			),
		[data, scope, scopeId],
	);

	const configured = scoped.filter(isConfigured);
	const documented = scoped.filter(isDocumentedUnset);

	const addAction = (
		<Button
			onClick={() => setTarget({ isEdit: false, key: '' })}
			size='sm'
			variant='secondary'
		>
			<PlusIcon aria-hidden='true' className='size-4' />
			Add environment variable
		</Button>
	);

	return (
		<>
			<SettingsSection
				action={addAction}
				description={description}
				title={title}
			>
				<div className='space-y-3 pt-4'>
					{isLoading ? (
						<div className='flex items-center gap-2 py-6 text-muted-foreground text-sm'>
							<Spinner className='size-4' /> Reading environment…
						</div>
					) : error ? (
						<div className='py-6 text-sm text-status-danger'>
							Failed to read environment: {String(error)}.
						</div>
					) : (
						<>
							{configured.length === 0 ? (
								<SettingsEmptyState
									description='Add a variable to make it available in this environment.'
									title='No variables set'
								/>
							) : (
								<div className='divide-y divide-border rounded-md border bg-card/40'>
									{configured.map((variable) => (
										<EnvironmentVariableRow
											key={variable.key}
											onEdit={(key) => setTarget({ isEdit: true, key })}
											scope={scope}
											scopeId={scopeId}
											variable={variable}
										/>
									))}
								</div>
							)}
							<DocumentedVariablesList
								onAdd={(key) => setTarget({ isEdit: false, key })}
								variables={documented}
							/>
							{enableEnvFiles ? (
								<div className='border-border border-t'>
									<EnvFilesSection scope={scope} scopeId={scopeId} />
								</div>
							) : null}
						</>
					)}
				</div>
			</SettingsSection>
			<EnvironmentVariableSheet
				onClose={() => setTarget(null)}
				scope={scope}
				scopeId={scopeId}
				target={target}
			/>
		</>
	);
}
