import { Link, useRouterState } from '@tanstack/react-router';
import type { TFunction } from 'i18next';
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
	PlugZapIcon,
	PuzzleIcon,
	ScrollIcon,
	SlidersHorizontalIcon,
	TerminalIcon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

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

/**
 * Builds the user-scope nav entries. The labels are `t()` calls rather than a
 * module-scope constant table so a language change re-renders them and so
 * `i18next-cli extract` can see every key statically.
 * @param t - Translation function from `useTranslation`
 * @returns The user-scope nav entries in display order
 */
function userNav(t: TFunction): UserNavItem[] {
	return [
		{
			kind: 'user',
			to: '/settings/general',
			label: t('settings:nav.general', 'General'),
			icon: SlidersHorizontalIcon,
		},
		{
			kind: 'user',
			to: '/settings/models',
			label: t('settings:nav.models', 'Models'),
			icon: BoxIcon,
		},
		{
			kind: 'user',
			to: '/settings/providers',
			label: t('settings:nav.providers', 'Providers'),
			icon: PlugZapIcon,
		},
		{
			kind: 'user',
			to: '/settings/environment',
			label: t('settings:nav.environment', 'Environment'),
			icon: KeyRoundIcon,
		},
		{
			kind: 'user',
			to: '/settings/git',
			label: t('settings:nav.git', 'Git'),
			icon: GitBranchIcon,
		},
		{
			kind: 'user',
			to: '/settings/appearance',
			label: t('settings:nav.appearance', 'Appearance'),
			icon: BrushIcon,
		},
		{
			kind: 'user',
			to: '/settings/integrations',
			label: t('settings:nav.integrations', 'Integrations'),
			icon: PuzzleIcon,
		},
		{
			group: 'more',
			icon: HeartPulseIcon,
			kind: 'user',
			label: t('settings:nav.diagnostics', 'Diagnostics'),
			to: '/settings/diagnostics',
		},
		{
			group: 'more',
			icon: FlaskConicalIcon,
			kind: 'user',
			label: t('settings:nav.experimental', 'Experimental'),
			to: '/settings/experimental',
		},
		{
			group: 'more',
			icon: BeakerIcon,
			kind: 'user',
			label: t('settings:nav.advanced', 'Advanced'),
			to: '/settings/advanced',
		},
	];
}

/**
 * Builds the repo-scope nav entries.
 * @param t - Translation function from `useTranslation`
 * @returns The repo-scope nav entries in display order
 */
function repoNav(t: TFunction): RepoNavItem[] {
	return [
		{
			icon: KeyRoundIcon,
			kind: 'repo',
			label: t('settings:repo-nav.environment', 'Environment'),
			section: 'environment',
		},
		{
			icon: GitBranchIcon,
			kind: 'repo',
			label: t('settings:repo-nav.git', 'Git'),
			section: 'git',
		},
		{
			icon: TerminalIcon,
			kind: 'repo',
			label: t('settings:repo-nav.scripts', 'Scripts'),
			section: 'scripts',
		},
		{
			icon: CableIcon,
			kind: 'repo',
			label: t('settings:repo-nav.actions', 'Actions'),
			section: 'actions',
		},
		{
			icon: ScrollIcon,
			kind: 'repo',
			label: t('settings:repo-nav.misc', 'Misc'),
			section: 'misc',
		},
	];
}

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
	const { t } = useTranslation();

	return (
		<nav
			aria-label={t('settings:nav.aria-label', 'Settings sections')}
			className='flex h-full w-56 shrink-0 flex-col gap-4 border-r bg-sidebar/60 px-2 py-3'
		>
			{scope === 'user' ? <UserNav /> : <RepoNav activeRepoId={activeRepoId} />}
		</nav>
	);
}

/** Renders the user-scope settings nav, split into a main group and a "More" group. */
function UserNav() {
	const { t } = useTranslation();
	const items = userNav(t);
	const main = items.filter((item) => item.group !== 'more');
	const more = items.filter((item) => item.group === 'more');
	return (
		<>
			<ul className='flex flex-col gap-0.5'>
				{main.map((item) => (
					<li key={item.to}>
						<UserNavLink item={item} />
					</li>
				))}
			</ul>
			<NavGroupLabel>{t('settings:nav.more', 'More')}</NavGroupLabel>
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
	const { t } = useTranslation();

	if (!activeRepoId) {
		return (
			<p className='px-2 py-1 text-muted-foreground text-xs'>
				{t('settings:repo-nav.empty', 'No repository selected.')}
			</p>
		);
	}
	return (
		<ul className='flex flex-col gap-0.5'>
			{repoNav(t).map((item) => (
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
			<span className='truncate' title={item.label}>
				{item.label}
			</span>
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
			<span className='truncate' title={item.label}>
				{item.label}
			</span>
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
