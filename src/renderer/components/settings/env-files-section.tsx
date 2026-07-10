import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FolderIcon, PlusIcon, XIcon } from 'lucide-react';
import { useState } from 'react';

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
		<div className='space-y-3 pt-6'>
			<div className='space-y-1'>
				<h2 className='font-medium text-foreground text-sm'>Env files</h2>
				<p className='text-muted-foreground text-sm leading-6'>
					Load environment variables from env files. In the native file picker,
					press{' '}
					<kbd className='rounded-sm bg-foreground/5 p-1 font-medium font-sans'>
						Cmd+Shift+.
					</kbd>{' '}
					to show hidden files.
				</p>
			</div>

			{paths.length > 0 ? (
				<ul className='divide-y divide-border rounded-md border bg-card/40'>
					{paths.map((path) => (
						<li
							className='flex items-center gap-2 px-3 py-2 text-sm'
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
								aria-label={`Remove ${path}`}
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
							onChange={(event) => setDraft(event.target.value)}
							placeholder='~/.env'
							spellCheck={false}
							value={draft}
						/>
						<Button
							aria-label='Browse for env file'
							onClick={() => void handleBrowse()}
							size='icon'
							variant='outline'
						>
							<FolderIcon aria-hidden='true' className='size-4' />
						</Button>
						<Button
							disabled={!draft.trim() || addMutation.isPending}
							onClick={handleAdd}
							variant='secondary'
						>
							Add
						</Button>
						<Button
							aria-label='Cancel'
							onClick={handleCancel}
							size='icon'
							variant='ghost'
						>
							<XIcon aria-hidden='true' className='size-4' />
						</Button>
					</div>
					{error ? <p className='text-sm text-status-danger'>{error}</p> : null}
				</div>
			) : (
				<Button onClick={() => setDraft('')} variant='outline'>
					<PlusIcon aria-hidden='true' className='size-4' />
					Add env file
				</Button>
			)}
		</div>
	);
}
