import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FolderIcon, PlusIcon, XIcon } from 'lucide-react';
import { useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import {
	addEnvFile,
	ensemblrQueryKeys,
	envFilesQuery,
	removeEnvFile,
	selectEnvFile,
} from '@/renderer/api/ensemblr';
import { Button } from '@/renderer/components/ui/button';
import { Input } from '@/renderer/components/ui/input';
import type { EnvironmentVariableScope } from '@/shared/ipc/contracts/environment';

/** Manages the list of env files loaded into a scope's session environment. */
export function EnvFilesSection({
	scope,
	scopeId,
}: {
	scope: EnvironmentVariableScope;
	scopeId?: string;
}) {
	const { t } = useTranslation();
	const queryClient = useQueryClient();
	const { data } = useQuery(envFilesQuery({ scope, scopeId }));
	const [draft, setDraft] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	const paths = data?.paths ?? [];

	const invalidate = async () => {
		await Promise.all([
			queryClient.invalidateQueries({
				queryKey: ensemblrQueryKeys.environmentFiles(scope, scopeId),
			}),
			queryClient.invalidateQueries({
				queryKey: ensemblrQueryKeys.environmentVariables(),
			}),
		]);
	};

	const addMutation = useMutation({
		mutationFn: (path: string) => addEnvFile({ path, scope, scopeId }),
		onSuccess: async (result) => {
			if (result.error) {
				setError(result.error);
				return;
			}

			setError(null);
			setDraft(null);
			await invalidate();
		},
	});

	const removeMutation = useMutation({
		mutationFn: (path: string) => removeEnvFile({ path, scope, scopeId }),
		onSuccess: invalidate,
	});

	const handleBrowse = async () => {
		const result = await selectEnvFile();
		if (!result.canceled && result.path) {
			setError(null);
			setDraft(result.path);
		}
	};

	const handleAdd = () => {
		const trimmed = draft?.trim();
		if (trimmed) {
			setError(null);
			addMutation.mutate(trimmed);
		}
	};

	const handleCancel = () => {
		setError(null);
		setDraft(null);
	};

	return (
		<div className='space-y-3 border-border border-t pt-5'>
			<div className='space-y-1'>
				<h2 className='font-medium text-foreground text-sm'>
					{t('settings:environment.env-files.title', 'Env files')}
				</h2>
				<p className='max-w-prose text-muted-foreground text-xs leading-relaxed'>
					<Trans
						components={{
							kbd: (
								<kbd className='rounded-sm bg-foreground/5 p-1 font-medium font-sans' />
							),
						}}
						defaults='Load environment variables from env files. In the native file picker, press <kbd>Cmd+Shift+.</kbd> to show hidden files.'
						i18nKey='settings:environment.env-files.description'
					/>
				</p>
			</div>

			{paths.length > 0 ? (
				<ul className='divide-y divide-border overflow-hidden rounded-xl border border-border bg-card/40'>
					{paths.map((path) => (
						<li
							className='flex items-center gap-2 px-3 py-2.5 text-sm'
							key={path}
						>
							<FolderIcon
								aria-hidden='true'
								className='size-3.5 shrink-0 text-muted-foreground'
							/>
							<code className='min-w-0 flex-1 truncate font-mono text-foreground text-xs'>
								{path}
							</code>
							<Button
								aria-label={t(
									'settings:environment.env-files.remove-aria-label',
									'Remove {{path}}',
									{ path },
								)}
								disabled={removeMutation.isPending}
								onClick={() => removeMutation.mutate(path)}
								size='icon-xs'
								variant='ghost'
							>
								<XIcon aria-hidden='true' className='size-3.5' />
							</Button>
						</li>
					))}
				</ul>
			) : null}

			{draft !== null ? (
				<div className='space-y-2'>
					<div className='flex items-center gap-2'>
						<Input
							autoFocus
							className='h-7 font-mono text-xs'
							onChange={(event) => setDraft(event.target.value)}
							placeholder='~/.env'
							spellCheck={false}
							value={draft}
						/>
						<Button
							aria-label={t(
								'settings:environment.env-files.browse-aria-label',
								'Browse for env file',
							)}
							onClick={() => void handleBrowse()}
							size='icon-sm'
							variant='outline'
						>
							<FolderIcon aria-hidden='true' className='size-3.5' />
						</Button>
						<Button
							disabled={!draft.trim() || addMutation.isPending}
							onClick={handleAdd}
							size='sm'
							variant='secondary'
						>
							{t('common:actions.add', 'Add')}
						</Button>
						<Button
							aria-label={t('common:actions.cancel', 'Cancel')}
							onClick={handleCancel}
							size='icon-sm'
							variant='ghost'
						>
							<XIcon aria-hidden='true' className='size-3.5' />
						</Button>
					</div>
					{error ? <p className='text-status-danger text-xs'>{error}</p> : null}
				</div>
			) : (
				<Button onClick={() => setDraft('')} size='sm' variant='outline'>
					<PlusIcon aria-hidden='true' data-icon='inline-start' />
					{t('settings:environment.env-files.add', 'Add env file')}
				</Button>
			)}
		</div>
	);
}
