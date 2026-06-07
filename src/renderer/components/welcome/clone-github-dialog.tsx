import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { KeyboardEvent } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
	ensembleQueryKeys,
	githubRepositoryListQuery,
	isEnsembleApiAvailable,
	prepareCloneGithubRepository,
	rootDirectoryQuery,
	selectCloneDestination,
	startCloneGithubRepository,
	subscribeCloneGithubRepositoryProgress,
} from '@/renderer/api/ensemble-queries';
import { Button } from '@/renderer/components/ui/button';
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from '@/renderer/components/ui/dialog';
import { Input } from '@/renderer/components/ui/input';
import { Label } from '@/renderer/components/ui/label';
import type { RecentGithubRepo } from '@/renderer/types/workbench';
import type {
	CloneGithubRepositoryDiagnostic,
	CloneGithubRepositoryProgressEvent,
	CloneGithubRepositoryStartResult,
	GithubRepositoryEntry,
} from '@/shared/ipc';

interface CloneGithubDialogProps {
	onOpenChange: (open: boolean) => void;
	open: boolean;
	recentRepos: RecentGithubRepo[];
}

/** Modal for cloning a GitHub repository into the managed root. */
export function CloneGithubDialog({
	onOpenChange,
	open,
	recentRepos,
}: CloneGithubDialogProps) {
	return (
		<Dialog
			onOpenChange={(next) => {
				onOpenChange(next);
			}}
			open={open}
		>
			<DialogContent className='gap-3 sm:max-w-lg'>
				<CloneGithubDialogForm
					key={open ? 'open' : 'closed'}
					onOpenChange={onOpenChange}
					recentRepos={recentRepos}
				/>
			</DialogContent>
		</Dialog>
	);
}

/** Top-level UI states the dialog moves through. */
type CloneStage = 'idle' | 'preparing' | 'cloning' | 'success' | 'failure';

/** State-owned clone form content that resets when the dialog open state changes. */
function CloneGithubDialogForm({
	onOpenChange,
	recentRepos,
}: {
	onOpenChange: (open: boolean) => void;
	recentRepos: RecentGithubRepo[];
}) {
	const queryClient = useQueryClient();
	const rootDirectory = useQuery({
		...rootDirectoryQuery,
		enabled: isEnsembleApiAvailable(),
	});
	const defaultParentPath = rootDirectory.data?.repositoriesPath ?? '';

	const githubRepoList = useQuery({
		...githubRepositoryListQuery,
		enabled: isEnsembleApiAvailable(),
	});
	const liveEntries = githubRepoList.data?.entries ?? [];
	const liveError =
		githubRepoList.data?.status === 'failure'
			? githubRepoList.data.error
			: undefined;
	const fallbackEntries: GithubRepositoryEntry[] = recentRepos.map((repo) => ({
		description: repo.description ?? null,
		fullName: repo.fullName,
		isPrivate: false,
		ownerLogin: repo.fullName.split('/')[0] ?? '',
		updatedAt: '',
	}));
	const displayedEntries =
		liveEntries.length > 0 ? liveEntries : fallbackEntries;

	const [url, setUrl] = useState('');
	const [location, setLocation] = useState('');
	const [locationTouched, setLocationTouched] = useState(false);
	const [stage, setStage] = useState<CloneStage>('idle');
	const [diagnostics, setDiagnostics] = useState<
		CloneGithubRepositoryDiagnostic[]
	>([]);
	const [logs, setLogs] = useState<CloneGithubRepositoryProgressEvent[]>([]);
	const [activeJobId, setActiveJobId] = useState<string | null>(null);
	const [successResult, setSuccessResult] =
		useState<CloneGithubRepositoryStartResult | null>(null);

	const trimmedUrl = url.trim();
	const canClone =
		stage !== 'preparing' &&
		stage !== 'cloning' &&
		trimmedUrl.length > 0 &&
		isEnsembleApiAvailable();
	const locationPlaceholder = defaultParentPath || 'Managed repos directory';

	const logRef = useRef<HTMLOListElement | null>(null);

	useEffect(() => {
		if (!logRef.current) {
			return;
		}
		logRef.current.scrollTop = logRef.current.scrollHeight;
	}, []);

	useEffect(() => {
		if (locationTouched || !defaultParentPath) {
			return;
		}
		setLocation(defaultParentPath);
	}, [defaultParentPath, locationTouched]);

	useEffect(() => {
		if (!activeJobId) {
			return;
		}
		const unsubscribe = subscribeCloneGithubRepositoryProgress((event) => {
			if (event.jobId !== activeJobId) {
				return;
			}
			setLogs((current) => [...current, event]);
		});
		return () => {
			unsubscribe();
		};
	}, [activeJobId]);

	const handleBrowse = useCallback(async () => {
		if (!isEnsembleApiAvailable()) {
			return;
		}
		const selection = await selectCloneDestination();
		if (selection.canceled || !selection.path) {
			return;
		}
		setLocationTouched(true);
		setLocation(selection.path);
	}, []);

	const handleClone = useCallback(async () => {
		if (!canClone) {
			return;
		}

		setStage('preparing');
		setDiagnostics([]);
		setLogs([]);
		setSuccessResult(null);
		setActiveJobId(null);

		const parentOverride = location.trim();
		const destinationPath = parentOverride
			? joinDestination(parentOverride, trimmedUrl)
			: undefined;

		const preparation = await prepareCloneGithubRepository(
			destinationPath !== undefined
				? { destinationPath, url: trimmedUrl }
				: { url: trimmedUrl },
		);

		if (!preparation.ok) {
			setStage('failure');
			setDiagnostics(preparation.diagnostics);
			return;
		}

		setActiveJobId(preparation.preparation.jobId);
		setStage('cloning');

		const result = await startCloneGithubRepository({
			jobId: preparation.preparation.jobId,
		});

		setLogs(result.logs);
		setActiveJobId(null);

		if (result.status === 'success' && result.repository) {
			setStage('success');
			setSuccessResult(result);
			await queryClient.invalidateQueries({
				queryKey: ensembleQueryKeys.repositoryWorkspaceNavigation(),
			});
			return;
		}

		setStage('failure');
		setDiagnostics(result.diagnostics);
	}, [canClone, location, queryClient, trimmedUrl]);

	const handleSubmitKey = useCallback(
		(event: KeyboardEvent<HTMLInputElement>) => {
			if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
				event.preventDefault();
				handleClone();
			}
		},
		[handleClone],
	);

	const handleClose = useCallback(() => {
		onOpenChange(false);
	}, [onOpenChange]);

	const handleRetry = useCallback(() => {
		setStage('idle');
		setDiagnostics([]);
	}, []);

	const isBusy = stage === 'preparing' || stage === 'cloning';

	return (
		<>
			<DialogHeader>
				<DialogTitle className='font-medium text-[0.9375rem]'>
					Clone GitHub repo
				</DialogTitle>
			</DialogHeader>

			<div className='flex flex-col gap-1.5'>
				<Label className='text-xs' htmlFor='clone-github-url'>
					Repository URL
				</Label>
				<Input
					autoFocus
					className='h-9'
					disabled={isBusy}
					id='clone-github-url'
					onChange={(event) => setUrl(event.target.value)}
					onKeyDown={handleSubmitKey}
					placeholder='https://github.com/user/repo.git'
					value={url}
				/>
			</div>

			<div className='flex flex-col gap-1.5'>
				<Label className='text-xs'>Recent repos</Label>
				<RecentReposList
					disabled={isBusy}
					isLoading={githubRepoList.isLoading}
					onSelect={(repo) => setUrl(`https://github.com/${repo.fullName}.git`)}
					repos={displayedEntries}
					selectedUrl={url}
				/>
				{liveError ? (
					<p className='text-[0.6875rem] text-muted-foreground'>{liveError}</p>
				) : null}
			</div>

			<div className='flex flex-col gap-1.5'>
				<Label className='text-xs' htmlFor='clone-github-location'>
					Destination parent
				</Label>
				<div className='flex gap-2'>
					<Input
						className='h-9 flex-1 font-mono text-xs'
						disabled={isBusy}
						id='clone-github-location'
						onChange={(event) => {
							setLocationTouched(true);
							setLocation(event.target.value);
						}}
						onKeyDown={handleSubmitKey}
						placeholder={locationPlaceholder}
						value={location}
					/>
					<Button
						className='h-9'
						disabled={isBusy || !isEnsembleApiAvailable()}
						onClick={handleBrowse}
						type='button'
						variant='outline'
					>
						Browse
					</Button>
				</div>
				{locationTouched &&
				defaultParentPath &&
				location !== defaultParentPath ? (
					<button
						className='self-start text-[0.6875rem] text-muted-foreground underline-offset-2 hover:underline'
						onClick={() => {
							setLocationTouched(false);
							setLocation(defaultParentPath);
						}}
						type='button'
					>
						Reset to managed repos directory
					</button>
				) : null}
			</div>

			{logs.length > 0 ? (
				<CloneProgressLog logRef={logRef} logs={logs} />
			) : null}

			{stage === 'failure' && diagnostics.length > 0 ? (
				<CloneDiagnosticsList diagnostics={diagnostics} />
			) : null}

			{stage === 'success' && successResult?.repository ? (
				<p className='text-emerald-500 text-xs'>
					Cloned {successResult.repository.name} to{' '}
					<span className='font-mono'>{successResult.repository.path}</span>.
				</p>
			) : null}

			<div className='-mx-4 -mb-4 flex justify-end gap-2 rounded-b-xl border-border border-t bg-muted/40 px-4 py-3'>
				{stage === 'failure' ? (
					<Button
						className='h-8'
						onClick={handleRetry}
						type='button'
						variant='outline'
					>
						Try again
					</Button>
				) : null}
				{stage === 'success' ? (
					<Button className='h-8' onClick={handleClose} type='button'>
						Done
					</Button>
				) : (
					<Button
						className='h-8 gap-2'
						disabled={!canClone}
						onClick={handleClone}
						type='button'
						variant='default'
					>
						{getCloneButtonLabel(stage)}
						<span
							aria-hidden='true'
							className='ml-1 inline-flex items-center gap-0.5 text-[0.6875rem] opacity-70'
						>
							⌘↵
						</span>
					</Button>
				)}
			</div>
		</>
	);
}

interface CloneProgressLogProps {
	logRef: React.MutableRefObject<HTMLOListElement | null>;
	logs: CloneGithubRepositoryProgressEvent[];
}

/** Live, scrollable progress log used while the clone runs. */
function CloneProgressLog({ logRef, logs }: CloneProgressLogProps) {
	// biome-ignore lint/correctness/useExhaustiveDependencies: logs.length triggers the auto-scroll when new lines arrive.
	useEffect(() => {
		if (!logRef.current) {
			return;
		}
		logRef.current.scrollTop = logRef.current.scrollHeight;
	}, [logRef, logs.length]);

	return (
		<ol
			className='max-h-40 overflow-y-auto rounded-md border border-border bg-background/60 px-2 py-1.5 font-mono text-[0.6875rem] text-muted-foreground'
			data-testid='clone-progress-log'
			ref={logRef}
		>
			{logs.map((event, index) => (
				<li
					className={
						event.kind === 'status'
							? 'text-foreground'
							: event.kind === 'stderr'
								? 'text-amber-500'
								: 'text-muted-foreground'
					}
					data-kind={event.kind}
					key={`${event.timestamp}-${index}`}
				>
					{event.text}
				</li>
			))}
		</ol>
	);
}

interface CloneDiagnosticsListProps {
	diagnostics: CloneGithubRepositoryDiagnostic[];
}

/** Failure detail card listing each diagnostic in execution order. */
function CloneDiagnosticsList({ diagnostics }: CloneDiagnosticsListProps) {
	return (
		<ul
			className='rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-destructive text-xs'
			data-testid='clone-diagnostics'
		>
			{diagnostics.map((diagnostic) => (
				<li className='flex flex-col gap-0.5' key={diagnostic.code}>
					<span className='font-medium'>{diagnostic.message}</span>
					{diagnostic.path ? (
						<span className='font-mono text-[0.6875rem] opacity-80'>
							{diagnostic.path}
						</span>
					) : null}
				</li>
			))}
		</ul>
	);
}

interface RecentReposListProps {
	disabled: boolean;
	isLoading: boolean;
	onSelect: (repo: GithubRepositoryEntry) => void;
	repos: GithubRepositoryEntry[];
	selectedUrl: string;
}

/** Pickable list of GitHub repos surfaced as quick-fill suggestions. */
function RecentReposList({
	disabled,
	isLoading,
	onSelect,
	repos,
	selectedUrl,
}: RecentReposListProps) {
	if (isLoading && repos.length === 0) {
		return (
			<div className='flex items-center justify-center rounded-lg border border-border bg-background/40 px-2.5 py-3 text-[0.6875rem] text-muted-foreground'>
				Loading repos from GitHub…
			</div>
		);
	}

	if (repos.length === 0) {
		return (
			<div className='flex items-center justify-center rounded-lg border border-border bg-background/40 px-2.5 py-3 text-[0.6875rem] text-muted-foreground'>
				No repos to suggest yet.
			</div>
		);
	}

	return (
		<ul className='flex max-h-44 flex-col overflow-y-auto rounded-lg border border-border bg-background/40'>
			{repos.map((repo) => {
				const expectedUrl = `https://github.com/${repo.fullName}.git`;
				const isSelected = selectedUrl === expectedUrl;
				return (
					<li key={repo.fullName}>
						<button
							aria-pressed={isSelected}
							className='flex w-full items-center gap-2.5 px-2.5 py-2 text-left transition-colors hover:bg-muted/60 disabled:cursor-not-allowed disabled:opacity-60 aria-pressed:bg-muted'
							disabled={disabled}
							onClick={() => onSelect(repo)}
							type='button'
						>
							<span
								aria-hidden='true'
								className='size-5 shrink-0 rounded-full ring-1 ring-foreground/10'
								style={{
									backgroundColor: ownerAvatarColor(repo.ownerLogin),
								}}
							/>
							<span className='flex min-w-0 flex-col leading-tight'>
								<span className='flex min-w-0 items-center gap-1.5 truncate text-foreground text-xs'>
									<span className='truncate'>{repo.fullName}</span>
									{repo.isPrivate ? (
										<span className='shrink-0 rounded-sm bg-muted px-1 py-px text-[0.625rem] text-muted-foreground uppercase tracking-wide'>
											Private
										</span>
									) : null}
								</span>
								{repo.description ? (
									<span className='truncate text-[0.6875rem] text-muted-foreground'>
										{repo.description}
									</span>
								) : null}
							</span>
						</button>
					</li>
				);
			})}
		</ul>
	);
}

/** Stable color swatch per owner login, derived without external assets. */
function ownerAvatarColor(login: string): string {
	if (!login) {
		return 'oklch(0.5 0.04 260)';
	}
	let hash = 0;
	for (let index = 0; index < login.length; index += 1) {
		hash = (hash * 31 + login.charCodeAt(index)) >>> 0;
	}
	const hue = hash % 360;
	return `oklch(0.62 0.13 ${hue})`;
}

/** Picks the clone button label that matches the current stage. */
function getCloneButtonLabel(stage: CloneStage): string {
	switch (stage) {
		case 'preparing':
			return 'Preparing…';
		case 'cloning':
			return 'Cloning…';
		case 'failure':
		case 'idle':
		case 'success':
			return 'Clone repo';
	}
}

/**
 * Derives the full clone target directory from a parent override and the URL,
 * appending the repository name extracted from the URL. Returns the raw parent
 * when no repository name can be parsed so the main process surfaces the
 * validation diagnostic.
 */
function joinDestination(parent: string, url: string): string {
	const name = extractRepositoryName(url);
	if (!name) {
		return parent;
	}
	return `${stripTrailingSlash(parent)}/${name}`;
}

/** Strips the final `/` from a path so segments can be re-joined. */
function stripTrailingSlash(value: string): string {
	return value.endsWith('/') ? value.replace(/\/+$/, '') : value;
}

const REPO_NAME_PATTERN =
	/(?:[/:])([\w.-]+?)(?:\.git)?(?:\/?$)|^([\w.-]+)\/([\w.-]+?)(?:\.git)?$/i;

/** Best-effort extraction of the repository name segment from a GitHub URL. */
function extractRepositoryName(url: string): string | null {
	const match = url.trim().match(REPO_NAME_PATTERN);
	if (!match) {
		return null;
	}
	const captured = match[1] ?? match[3];
	if (!captured) {
		return null;
	}
	return captured.replace(/\.git$/i, '');
}
