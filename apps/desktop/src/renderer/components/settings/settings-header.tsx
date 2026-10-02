import { useNavigate, useRouterState } from '@tanstack/react-router';
import { ArrowLeftIcon, FileCodeIcon } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
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

/** Top toolbar: leading window-chrome inset, back button, scope tabs, repo picker. */
export function SettingsHeader({
	activeRepoId,
	projects,
	scope,
}: {
	scope: SettingsScope;
	projects: ProjectShellModel[];
	activeRepoId: string | null;
}) {
	const { t } = useTranslation();
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
	const configLabel = t('settings:header.edit-config', 'Edit in {{file}}', {
		file: scope === 'user' ? 'config.json' : '.ensemblr/settings.toml',
	});

	return (
		<header className='native-toolbar window-chrome-spacer flex shrink-0 items-center gap-3 border-b pr-3 pl-[var(--ensemblr-window-chrome-safe-start)]'>
			<Button onClick={closeSettings} size='sm' variant='ghost'>
				<ArrowLeftIcon aria-hidden='true' className='size-4' />
				<span>{t('common:actions.back', 'Back')}</span>
			</Button>
			<div className='flex min-w-0 items-center gap-2'>
				<div className='flex shrink-0 items-center gap-0.5 rounded-lg bg-muted/70 p-0.5'>
					<ScopeTab
						active={scope === 'user'}
						label={t('settings:header.scope-user', 'User')}
						onClick={() => handleScopeChange('user')}
					/>
					<ScopeTab
						active={scope === 'repo'}
						disabled={disableRepoTab}
						label={t('settings:header.scope-repo', 'Repo')}
						onClick={() => handleScopeChange('repo')}
					/>
				</div>
				{scope === 'repo' && projects.length > 0 ? (
					<Select
						onValueChange={handleRepoChange}
						value={activeRepoId ?? undefined}
					>
						<SelectTrigger
							aria-label={t(
								'settings:header.repo-picker.aria-label',
								'Active repository',
							)}
							className='max-w-56'
							size='sm'
						>
							<SelectValue
								placeholder={t(
									'settings:header.repo-picker.placeholder',
									'Select repository',
								)}
							/>
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
	const { t } = useTranslation();
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
			menuAriaLabel={t(
				'settings:header.open-menu.aria-label',
				'{{label}} — choose an app',
				{ label },
			)}
			onInvoke={(target) => void invokeTarget(target)}
			openTargets={openTargets}
			primaryAriaLabel={t(
				'settings:header.open-primary.aria-label',
				'{{label}} in {{app}}',
				{ app: primaryTarget.label, label },
			)}
			primaryLabel={label}
			primaryTarget={primaryTarget}
		/>
	);
}

/** One half of the User/Repo segmented switch; the active half is a raised pill. */
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
		<button
			aria-pressed={active}
			className={cn(
				'inline-flex h-6 select-none items-center rounded-md px-2.5 font-medium text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50',
				active
					? 'bg-background text-foreground shadow-2xs'
					: 'text-muted-foreground hover:text-foreground',
			)}
			disabled={disabled}
			onClick={onClick}
			type='button'
		>
			{label}
		</button>
	);
}
