import { Link, useNavigate, useRouterState } from '@tanstack/react-router';
import { ArrowLeftIcon, FileCodeIcon } from 'lucide-react';

import {
	REPO_SECTION_TARGETS,
	type RepoSectionId,
	type SettingsScope,
} from '@/renderer/components/settings/settings-sidebar';
import { Button } from '@/renderer/components/ui/button';
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/renderer/components/ui/select';
import { ProjectAvatar } from '@/renderer/components/workbench-shell/project-avatar';
import { cn } from '@/renderer/lib/utils';
import type { ProjectShellModel } from '@/renderer/types/workbench';

interface SettingsHeaderProps {
	scope: SettingsScope;
	projects: ProjectShellModel[];
	activeRepoId: string | null;
}

const USER_DEFAULT = '/settings/general';
const KNOWN_REPO_SECTIONS = Object.keys(
	REPO_SECTION_TARGETS,
) as RepoSectionId[];

// TODO: wire to native file-open IPC — opens user config.json or per-repo ensemble.json in OS default editor.
function handleEditConfig() {}

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
}: SettingsHeaderProps) {
	const navigate = useNavigate();
	const pathname = useRouterState({ select: (s) => s.location.pathname });

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
	const configLabel =
		scope === 'user' ? 'Edit in config.json' : 'Edit in ensemble.json';

	return (
		<header className='native-toolbar macos-traffic-light-spacer flex h-11 shrink-0 items-center gap-3 border-b pr-3 pl-[var(--ensemble-traffic-light-safe-inline)]'>
			<Button asChild size='sm' variant='ghost'>
				<Link preload='intent' to='/'>
					<ArrowLeftIcon aria-hidden='true' className='size-4' />
					<span>Back</span>
				</Link>
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
				<Button onClick={handleEditConfig} size='sm' variant='ghost'>
					<FileCodeIcon aria-hidden='true' className='size-4' />
					<span>{configLabel}</span>
				</Button>
			</div>
		</header>
	);
}

interface ScopeTabProps {
	active: boolean;
	label: string;
	disabled?: boolean;
	onClick: () => void;
}

function ScopeTab({ active, disabled, label, onClick }: ScopeTabProps) {
	return (
		<button
			aria-pressed={active}
			className={cn(
				'relative px-2 py-1.5 font-medium text-xs transition-colors',
				active
					? 'text-foreground'
					: 'text-muted-foreground hover:text-foreground',
				disabled && 'cursor-not-allowed opacity-50 hover:text-muted-foreground',
			)}
			disabled={disabled}
			onClick={onClick}
			type='button'
		>
			{label}
			{active ? (
				<span
					aria-hidden='true'
					className='absolute inset-x-1 -bottom-px h-px bg-foreground'
				/>
			) : null}
		</button>
	);
}
