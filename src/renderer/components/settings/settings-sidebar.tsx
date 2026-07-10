import { Link, useRouterState } from '@tanstack/react-router';
import type { LucideIcon } from 'lucide-react';
import {
	BeakerIcon,
	BoxIcon,
	BrushIcon,
	CableIcon,
	FlaskConicalIcon,
	GitBranchIcon,
	HeartPulseIcon,
	KeyRoundIcon,
	PuzzleIcon,
	ScrollIcon,
	SlidersHorizontalIcon,
	TerminalIcon,
} from 'lucide-react';

import { cn } from '@/renderer/lib/utils';
import type { SettingsScope } from '@/renderer/types/settings';

/** A user-scope settings nav entry. */
interface UserNavItem {
	kind: 'user';
	to: string;
	label: string;
	icon: LucideIcon;
	group?: 'main' | 'more';
}

/** A repo-scope settings nav entry. */
interface RepoNavItem {
	kind: 'repo';
	section: RepoSectionId;
	label: string;
	icon: LucideIcon;
}

const USER_NAV: UserNavItem[] = [
	{
		kind: 'user',
		to: '/settings/general',
		label: 'General',
		icon: SlidersHorizontalIcon,
	},
	{ kind: 'user', to: '/settings/models', label: 'Models', icon: BoxIcon },
	{
		kind: 'user',
		to: '/settings/environment',
		label: 'Environment',
		icon: KeyRoundIcon,
	},
	{ kind: 'user', to: '/settings/git', label: 'Git', icon: GitBranchIcon },
	{
		kind: 'user',
		to: '/settings/appearance',
		label: 'Appearance',
		icon: BrushIcon,
	},
	{
		kind: 'user',
		to: '/settings/integrations',
		label: 'Integrations',
		icon: PuzzleIcon,
	},
	{
		group: 'more',
		icon: HeartPulseIcon,
		kind: 'user',
		label: 'Diagnostics',
		to: '/settings/diagnostics',
	},
	{
		group: 'more',
		icon: FlaskConicalIcon,
		kind: 'user',
		label: 'Experimental',
		to: '/settings/experimental',
	},
	{
		group: 'more',
		icon: BeakerIcon,
		kind: 'user',
		label: 'Advanced',
		to: '/settings/advanced',
	},
];

const REPO_NAV: RepoNavItem[] = [
	{
		icon: KeyRoundIcon,
		kind: 'repo',
		label: 'Environment',
		section: 'environment',
	},
	{ icon: GitBranchIcon, kind: 'repo', label: 'Git', section: 'git' },
	{ icon: TerminalIcon, kind: 'repo', label: 'Scripts', section: 'scripts' },
	{ icon: CableIcon, kind: 'repo', label: 'Actions', section: 'actions' },
	{ icon: ScrollIcon, kind: 'repo', label: 'Misc', section: 'misc' },
];

const REPO_SECTION_TARGETS = {
	actions: '/settings/repo/$repoId/actions',
	environment: '/settings/repo/$repoId/environment',
	git: '/settings/repo/$repoId/git',
	misc: '/settings/repo/$repoId/misc',
	scripts: '/settings/repo/$repoId/scripts',
} as const;

/** Section id for the per-repo settings sub-nav. Derived from the route map. */
type RepoSectionId = keyof typeof REPO_SECTION_TARGETS;

/** Left-rail navigation for settings sections, scoped to User or Repo. */
export function SettingsSidebar({
	activeRepoId,
	scope,
}: {
	scope: SettingsScope;
	activeRepoId: string | null;
}) {
	return (
		<nav
			aria-label='Settings sections'
			className='flex h-full w-56 shrink-0 flex-col gap-4 border-r bg-sidebar/60 px-2 py-3'
		>
			{scope === 'user' ? <UserNav /> : <RepoNav activeRepoId={activeRepoId} />}
		</nav>
	);
}

/** Renders the user-scope settings nav, split into a main group and a "More" group. */
function UserNav() {
	const main = USER_NAV.filter((item) => item.group !== 'more');
	const more = USER_NAV.filter((item) => item.group === 'more');
	return (
		<>
			<ul className='flex flex-col gap-0.5'>
				{main.map((item) => (
					<li key={item.to}>
						<UserNavLink item={item} />
					</li>
				))}
			</ul>
			<NavGroupLabel>More</NavGroupLabel>
			<ul className='flex flex-col gap-0.5'>
				{more.map((item) => (
					<li key={item.to}>
						<UserNavLink item={item} />
					</li>
				))}
			</ul>
		</>
	);
}

/** Renders the repo-scope settings nav, or a placeholder when no repository is selected. */
function RepoNav({ activeRepoId }: { activeRepoId: string | null }) {
	if (!activeRepoId) {
		return (
			<p className='px-2 py-1 text-muted-foreground text-xs'>
				No repository selected.
			</p>
		);
	}
	return (
		<ul className='flex flex-col gap-0.5'>
			{REPO_NAV.map((item) => (
				<li key={item.section}>
					<RepoNavLink item={item} repoId={activeRepoId} />
				</li>
			))}
		</ul>
	);
}

/** Renders a small uppercase label heading a settings nav group. */
function NavGroupLabel({ children }: { children: string }) {
	return (
		<div className='px-2 pt-1 font-medium text-[0.6875rem] text-muted-foreground uppercase tracking-wide'>
			{children}
		</div>
	);
}

/** Renders a user-scope settings nav link, highlighted when its route is active. */
function UserNavLink({ item }: { item: UserNavItem }) {
	const pathname = useRouterState({ select: (s) => s.location.pathname });
	const isActive = pathname === item.to;
	const Icon = item.icon;

	return (
		<Link className={navLinkClass(isActive)} preload='intent' to={item.to}>
			<Icon aria-hidden='true' className='size-4 text-muted-foreground' />
			<span className='truncate'>{item.label}</span>
		</Link>
	);
}

/** Renders a repo-scope settings nav link, highlighted when its section is active. */
function RepoNavLink({ item, repoId }: { item: RepoNavItem; repoId: string }) {
	const pathname = useRouterState({ select: (s) => s.location.pathname });
	const target = REPO_SECTION_TARGETS[item.section];
	const isActive = pathname.endsWith(`/${item.section}`);
	const Icon = item.icon;

	return (
		<Link
			className={navLinkClass(isActive)}
			params={{ repoId }}
			preload='intent'
			to={target}
		>
			<Icon aria-hidden='true' className='size-4 text-muted-foreground' />
			<span className='truncate'>{item.label}</span>
		</Link>
	);
}

/**
 * Build the class string for a settings nav link.
 * @param active - Whether the link points at the current route
 * @returns The composed Tailwind class string
 */
function navLinkClass(active: boolean): string {
	return cn(
		'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors',
		active
			? 'bg-sidebar-accent text-sidebar-accent-foreground'
			: 'text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground',
	);
}

export type { RepoSectionId };
export { REPO_SECTION_TARGETS };
