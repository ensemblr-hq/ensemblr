import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { TFunction } from 'i18next';
import { CheckIcon, FolderOpenIcon, FolderSymlinkIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
	ensemblrQueryKeys,
	forgetLinkedDirectoryRecent,
	linkedDirectoryRecentsQuery,
	selectLinkedDirectory,
} from '@/renderer/api/ensemblr';
import {
	Command,
	CommandDialog,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from '@/renderer/components/ui/command';
import { cn } from '@/renderer/lib/utils';
import type { LinkedDirectory } from '@/renderer/types/workbench';
import type { RecordLinkedDirectoryFailureCode } from '@/shared/ipc/contracts/linked-directories';

/**
 * Turns a link failure into the sentence the user reads. Main returns a
 * locale-neutral code precisely so this mapping can live in the renderer.
 * @param t - Translator from `useTranslation`.
 * @param code - The failure main reported.
 * @returns The localized explanation.
 */
function linkFailureText(
	t: TFunction,
	code: RecordLinkedDirectoryFailureCode,
): string {
	if (code === 'not-a-directory') {
		return t(
			'workbench:link-directory.error.not-a-directory',
			'That path is a file, not a directory.',
		);
	}
	if (code === 'invalid-path') {
		return t(
			'workbench:link-directory.error.invalid-path',
			'That path could not be understood.',
		);
	}
	return t(
		'workbench:link-directory.error.read-failed',
		'That directory could not be read.',
	);
}

/**
 * Command-palette picker for giving this chat's agent access to a directory
 * outside its workspace: the folders linked most recently, plus a browse row for
 * anything else. The recents list is app-global, so a folder linked from one
 * project is one keystroke away in the next.
 */
export function LinkDirectoryDialog({
	linkedDirectories,
	onLink,
	onOpenChange,
	onUnlink,
	open,
}: {
	linkedDirectories: readonly LinkedDirectory[];
	onLink: (path: string) => Promise<RecordLinkedDirectoryFailureCode | null>;
	onOpenChange: (open: boolean) => void;
	onUnlink: (path: string) => void;
	open: boolean;
}) {
	const { t } = useTranslation();
	const queryClient = useQueryClient();
	const [error, setError] = useState<string | null>(null);
	const { data, isLoading } = useQuery({
		...linkedDirectoryRecentsQuery,
		enabled: open,
	});
	const recents = data?.entries ?? [];
	const linkedPaths = new Set(linkedDirectories.map((entry) => entry.path));

	/** Links a path and closes on success, keeping the dialog open to show a failure. */
	const link = async (path: string) => {
		const failure = await onLink(path);
		if (failure) {
			setError(linkFailureText(t, failure));
			return;
		}
		setError(null);
		onOpenChange(false);
	};

	/**
	 * Drops a directory that no longer exists from the recents list. Picking a
	 * missing row cannot link it, so the click removes it instead — otherwise a
	 * folder deleted months ago sits in the list with nothing the user can do.
	 */
	const forget = async (path: string) => {
		await forgetLinkedDirectoryRecent({ path });
		void queryClient.invalidateQueries({
			queryKey: ensemblrQueryKeys.linkedDirectoryRecents(),
		});
	};

	/** Opens the native picker, then links whatever the user chose. */
	const browse = async () => {
		const selection = await selectLinkedDirectory();
		if (selection.canceled) {
			return;
		}
		await link(selection.path);
	};

	return (
		<CommandDialog
			className='max-w-xl translate-y-0 sm:max-w-xl'
			description={t(
				'workbench:link-directory.description',
				'Give this chat’s agent access to a directory outside the workspace.',
			)}
			onOpenChange={(next) => {
				if (!next) {
					setError(null);
				}
				onOpenChange(next);
			}}
			open={open}
			title={t('workbench:link-directory.title', 'Link directory')}
		>
			<Command className='rounded-xl border-0'>
				<CommandInput
					placeholder={t(
						'workbench:link-directory.search-placeholder',
						'Search directories…',
					)}
				/>
				<CommandList className='max-h-80'>
					<CommandEmpty className='py-8 text-muted-foreground text-xs'>
						{isLoading
							? t('workbench:link-directory.loading', 'Loading directories…')
							: t(
									'workbench:link-directory.empty',
									'No directories match your search.',
								)}
					</CommandEmpty>
					<CommandGroup
						heading={t('workbench:link-directory.group', 'Directories')}
					>
						<CommandItem
							className='h-11 gap-2'
							keywords={[
								t('workbench:link-directory.browse', 'Browse…'),
								'browse',
							]}
							onSelect={() => void browse()}
							value='linked-directory:browse'
						>
							<FolderOpenIcon
								aria-hidden='true'
								className='size-4 shrink-0 text-muted-foreground'
							/>
							<span className='min-w-0 flex-1 truncate text-[0.8125rem]'>
								{t('workbench:link-directory.browse', 'Browse…')}
							</span>
						</CommandItem>
						{recents.map((entry) => (
							<CommandItem
								className={cn('h-11 gap-2', !entry.exists && 'opacity-60')}
								key={entry.path}
								keywords={[entry.name, entry.path]}
								onSelect={() => {
									if (!entry.exists) {
										void forget(entry.path);
										return;
									}
									if (linkedPaths.has(entry.path)) {
										onUnlink(entry.path);
										onOpenChange(false);
										return;
									}
									void link(entry.path);
								}}
								value={entry.path}
							>
								<span className='flex w-4 shrink-0 items-center justify-center'>
									{linkedPaths.has(entry.path) ? (
										<CheckIcon aria-hidden='true' className='size-4' />
									) : (
										<FolderSymlinkIcon
											aria-hidden='true'
											className='size-4 text-muted-foreground'
										/>
									)}
								</span>
								<span className='shrink-0 truncate text-[0.8125rem]'>
									{entry.name}
								</span>
								<span className='min-w-0 flex-1 truncate text-muted-foreground text-xxs'>
									{entry.path}
								</span>
								{entry.exists ? null : (
									<span className='shrink-0 text-muted-foreground text-xxs'>
										{t(
											'workbench:link-directory.missing',
											'Missing — select to remove',
										)}
									</span>
								)}
							</CommandItem>
						))}
					</CommandGroup>
				</CommandList>
				{error ? (
					<p
						className='mx-1 mb-1 rounded-lg bg-destructive/10 px-2 py-1.5 text-destructive text-xs'
						role='alert'
					>
						{error}
					</p>
				) : null}
			</Command>
		</CommandDialog>
	);
}
