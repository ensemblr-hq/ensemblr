import { useNavigate, useRouterState } from '@tanstack/react-router';
import { ArrowLeftIcon, FileCodeIcon } from 'lucide-react';
import { useMemo } from 'react';
import {
	REPO_SECTION_TARGETS,
	type RepoSectionId,
} from '@/renderer/components/settings/settings-sidebar';
import { Button } from '@/renderer/components/ui/button';
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/renderer/components/ui/select';
import { OpenTargetSplitButton } from '@/renderer/components/workbench-shell/open-target-split-button';
import { ProjectAvatar } from '@/renderer/components/workbench-shell/project-avatar';
import { useCloseSettings } from '@/renderer/hooks/use-close-settings';
import { useSettingsFileOpenTargets } from '@/renderer/hooks/use-settings-file-open-targets';
import { cn } from '@/renderer/lib/utils';
import type { SettingsScope } from '@/renderer/types/settings';
import type { ProjectShellModel } from '@/renderer/types/workbench';
import type { SettingsConfigFile } from '@/shared/ipc/contracts/open-target';

const USER_DEFAULT = '/settings/general';
const KNOWN_REPO_SECTIONS = Object.keys(
	REPO_SECTION_TARGETS,
) as RepoSectionId[];

/**
 * Resolve the active repo settings section from a pathname, falling back to the
 * environment section for unknown paths.
 * @param pathname - Current router pathname
 * @returns The matching repo section id
 */
function getRepoSectionFromPath(pathname: string): RepoSectionId {
	const last = pathname.split('/').filter(Boolean).at(-1) ?? '';
	return (
		KNOWN_REPO_SECTIONS.find((section) => section === last) ?? 'environment'
	);
}

/** Top toolbar: macOS traffic-light spacing, back button, scope tabs, repo picker. */
export function SettingsHeader({
	activeRepoId,
	projects,
	scope,
}: {
	scope: SettingsScope;
	projects: ProjectShellModel[];
	activeRepoId: string | null;
}) {
	const navigate = useNavigate();
	const pathname = useRouterState({ select: (s) => s.location.pathname });
	const closeSettings = useCloseSettings();

	const handleScopeChange = (next: SettingsScope) => {
		if (next === scope) return;
		if (next === 'user') {
			navigate({ to: USER_DEFAULT });
			return;
		}
		if (activeRepoId) {
			const section = getRepoSectionFromPath(pathname);
			navigate({
				params: { repoId: activeRepoId },
				to: REPO_SECTION_TARGETS[section],
			});
			return;
		}
		navigate({ to: '/settings/repo' });
	};

	const handleRepoChange = (nextRepoId: string) => {
		const section = getRepoSectionFromPath(pathname);
		navigate({
			params: { repoId: nextRepoId },
			to: REPO_SECTION_TARGETS[section],
		});
	};

	const disableRepoTab = projects.length === 0;

	// User scope opens ~/.config/ensemblr/config.json; repo scope opens the active
	// repo's committed .ensemblr/settings.toml. Both are created if missing.
	const activeRepo = projects.find((project) => project.id === activeRepoId);
	const configLabel =
		scope === 'user'
			? 'Edit in config.json'
			: 'Edit in .ensemblr/settings.toml';

	return (
		<header className='native-toolbar macos-traffic-light-spacer flex h-11 shrink-0 items-center gap-3 border-b pr-3 pl-[var(--ensemblr-traffic-light-safe-inline)]'>
			<Button onClick={closeSettings} size='sm' variant='ghost'>
				<ArrowLeftIcon aria-hidden='true' className='size-4' />
				<span>Back</span>
			</Button>
			<div className='ml-2 flex items-center gap-1'>
				<ScopeTab
					active={scope === 'user'}
					label='User'
					onClick={() => handleScopeChange('user')}
				/>
				<ScopeTab
					active={scope === 'repo'}
					disabled={disableRepoTab}
					label='Repo'
					onClick={() => handleScopeChange('repo')}
				/>
				{scope === 'repo' && projects.length > 0 ? (
					<Select
						onValueChange={handleRepoChange}
						value={activeRepoId ?? undefined}
					>
						<SelectTrigger
							aria-label='Active repository'
							className='ml-6'
							size='sm'
						>
							<SelectValue placeholder='Select repository' />
						</SelectTrigger>
						<SelectContent>
							{projects.map((project) => (
								<SelectItem key={project.id} value={project.id}>
									<ProjectAvatar
										className='bg-transparent'
										project={project}
										size='sm'
									/>
									<span className='truncate'>{project.name}</span>
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				) : null}
			</div>
			<div className='ml-auto'>
				<EditConfigMenu
					activeRepoPath={
						scope === 'repo' ? (activeRepo?.pathLabel ?? null) : null
					}
					label={configLabel}
					scope={scope}
				/>
			</div>
		</header>
	);
}

/**
 * "Edit in…" split button for the active settings file. Reuses the workbench
 * open-in menu so the file opens in the user's default/last-used app with a
 * chevron to pick another. Renders a disabled placeholder while the app list
 * loads or when a repo scope has no active repository.
 */
function EditConfigMenu({
	activeRepoPath,
	label,
	scope,
}: {
	scope: SettingsScope;
	label: string;
	activeRepoPath: string | null;
}) {
	const config = useMemo<SettingsConfigFile>(
		() =>
			scope === 'user'
				? { scope: 'user' }
				: { repositoryPath: activeRepoPath ?? '', scope: 'repo' },
		[activeRepoPath, scope],
	);
	const { invokeTarget, openTargets, primaryTarget } =
		useSettingsFileOpenTargets(config);

	const unavailable = scope === 'repo' && !activeRepoPath;
	if (unavailable || !openTargets || !primaryTarget) {
		return (
			<Button disabled size='sm' variant='ghost'>
				<FileCodeIcon aria-hidden='true' className='size-4' />
				<span>{label}</span>
			</Button>
		);
	}

	return (
		<OpenTargetSplitButton
			menuAriaLabel={`${label} — choose an app`}
			onInvoke={(target) => void invokeTarget(target)}
			openTargets={openTargets}
			primaryAriaLabel={`${label} in ${primaryTarget.label}`}
			primaryLabel={label}
			primaryTarget={primaryTarget}
		/>
	);
}

/** Renders a User/Repo scope tab with an active-state underline. */
function ScopeTab({
	active,
	disabled,
	label,
	onClick,
}: {
	active: boolean;
	label: string;
	disabled?: boolean;
	onClick: () => void;
}) {
	return (
		<Button
			aria-pressed={active}
			className={cn(
				'relative h-auto rounded-none bg-transparent px-2 py-1.5 text-xs hover:bg-transparent aria-pressed:bg-transparent',
				active ? 'text-foreground' : undefined,
			)}
			disabled={disabled}
			onClick={onClick}
			size='sm'
			variant='ghost'
		>
			{label}
			{active ? (
				<span
					aria-hidden='true'
					className='absolute inset-x-1 -bottom-px h-px bg-foreground'
				/>
			) : null}
		</Button>
	);
}
