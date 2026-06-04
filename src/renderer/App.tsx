import {
	ActivityIcon,
	BadgeCheckIcon,
	CircleDotIcon,
	FileCodeIcon,
	FolderGit2Icon,
	GitBranchIcon,
	LayoutDashboardIcon,
	Settings2Icon,
	ShieldCheckIcon,
	SlidersHorizontalIcon,
	WrenchIcon,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import {
	AppFrame,
	type ShellHealth,
	type ShellRoute,
} from '@/components/app-frame';
import { DesignSystemPreview } from '@/components/design-system-preview';
import { ShellPanel } from '@/components/shell-panel';
import { StatusBadge } from '@/components/status-badge';
import { TerminalDock } from '@/components/terminal-dock';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { HealthSnapshot } from '@/shared/ipc';

type RouteId = 'dashboard' | 'setup' | 'workspace' | 'settings';

const ROUTES: readonly ShellRoute<RouteId>[] = [
	{
		badge: '4',
		description:
			'Centralized shell, token surfaces, and component seams for the future repository and workspace overview.',
		eyebrow: 'App shell',
		icon: LayoutDashboardIcon,
		id: 'dashboard',
		label: 'Dashboard',
		title: 'Piductor workspace control',
	},
	{
		badge: '3',
		description:
			'Readiness checks will validate Git, gh, Pi RPC, local commands, and configuration before agent execution.',
		eyebrow: 'Setup gate',
		icon: ShieldCheckIcon,
		id: 'setup',
		label: 'Setup',
		title: 'Preflight checks before agent work',
	},
	{
		badge: '1',
		description:
			'Workspace route foundation for Pi sessions, terminal dock, review deltas, and merge workflow controls.',
		eyebrow: 'Workspace',
		icon: FolderGit2Icon,
		id: 'workspace',
		label: 'Workspace',
		title: 'Isolated task surface',
	},
	{
		badge: '2',
		description:
			'Configuration shell for app, repository, provider, integration, security, and appearance binding work.',
		eyebrow: 'Settings',
		icon: Settings2Icon,
		id: 'settings',
		label: 'Settings',
		title: 'Configuration with visible sources',
	},
];

const routeFoundation: Record<
	RouteId,
	{
		items: string[];
		status: string;
		summary: string;
	}
> = {
	dashboard: {
		items: [
			'Route tabs are wired without introducing a router yet.',
			'Generated shadcn source remains isolated under src/components/ui.',
			'Product wrappers own the app shell, panes, dock, and preview fixtures.',
		],
		status: 'Foundation active',
		summary:
			'Compact app shell fixture for the future repository and workspace overview.',
	},
	setup: {
		items: [
			'Setup checks reserve states for success, warning, and pending work.',
			'Fields and controls match the future settings and setup-gate model.',
			'IPC health stays visible for runtime diagnostics.',
		],
		status: 'Checks stubbed',
		summary:
			'Static setup surface that establishes the control vocabulary for checks.',
	},
	workspace: {
		items: [
			'Terminal and diff surfaces define the future workspace dock contract.',
			'Code, terminal, and diff colors use separate semantic tokens.',
			'Sidebar, route tabs, and pane controls expose focus states.',
		],
		status: 'Dock ready',
		summary:
			'Workspace route validates the terminal dock and review-pane foundation.',
	},
	settings: {
		items: [
			'Appearance controls are preview fixtures, not final product settings.',
			'Overlay primitives are available for source and integration inspectors.',
			'Field layout uses generated Field and InputGroup composition.',
		],
		status: 'Bindings deferred',
		summary:
			'Settings stays scoped to foundation components and avoids final preference flows.',
	},
};

const changedFiles = [
	{ name: 'src/components/app-frame.tsx', status: 'modified' },
	{ name: 'src/components/design-system-preview.tsx', status: 'modified' },
	{ name: 'src/components/terminal-dock.tsx', status: 'modified' },
	{ name: 'src/renderer/styles.css', status: 'modified' },
	{ name: 'components.json', status: 'added' },
];

export function App() {
	const [activeRoute, setActiveRoute] = useState<RouteId>('dashboard');
	const [health, setHealth] = useState<HealthSnapshot | null>(null);
	const [healthError, setHealthError] = useState<string | null>(null);

	useEffect(() => {
		let isMounted = true;
		const piductor = window.piductor;

		if (!piductor) {
			setHealthError('Electron preload bridge is unavailable in this context.');
			return () => {
				isMounted = false;
			};
		}

		piductor
			.health()
			.then((snapshot) => {
				if (isMounted) {
					setHealth(snapshot);
				}
			})
			.catch((error: unknown) => {
				if (isMounted) {
					setHealthError(
						error instanceof Error ? error.message : 'Unknown IPC failure',
					);
				}
			});

		return () => {
			isMounted = false;
		};
	}, []);

	const shellHealth = useMemo<ShellHealth>(() => {
		if (health) {
			return {
				detail: `Electron ${health.versions.electron} on ${health.platform}.`,
				label: `${health.appName} IPC online`,
				state: 'online',
			};
		}

		if (healthError) {
			return {
				detail: healthError,
				label: 'IPC unavailable',
				state: 'unavailable',
			};
		}

		return {
			detail: 'Renderer is calling the typed preload bridge.',
			label: 'Checking IPC',
			state: 'pending',
		};
	}, [health, healthError]);

	const activeRouteConfig =
		ROUTES.find((route) => route.id === activeRoute) ?? ROUTES[0];
	const foundation = routeFoundation[activeRoute];

	return (
		<AppFrame
			activeRoute={activeRoute}
			health={shellHealth}
			onRouteChange={setActiveRoute}
			routes={ROUTES}
		>
			<div className='grid h-full min-h-0 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_20rem]'>
				<section className='flex min-h-0 flex-col overflow-hidden border-border lg:border-r'>
					<div className='min-h-0 flex-1 overflow-y-auto p-3'>
						<div className='flex flex-col gap-3'>
							<ShellPanel
								action={
									<StatusBadge tone='info'>THE-102 / PID-002</StatusBadge>
								}
								description={foundation.summary}
								eyebrow={activeRouteConfig.eyebrow}
								title={foundation.status}
							>
								<div className='flex flex-col divide-y divide-border rounded-md border border-border bg-pane'>
									{foundation.items.map((item) => (
										<div
											className='flex items-start gap-2 px-3 py-2'
											key={item}
										>
											<BadgeCheckIcon
												aria-hidden='true'
												className='mt-1 size-3.5 shrink-0 text-status-ok'
											/>
											<p className='text-xs leading-5'>{item}</p>
										</div>
									))}
								</div>
							</ShellPanel>

							<DesignSystemPreview />
						</div>
					</div>

					<div className='shrink-0 border-border border-t bg-pane/55 p-3'>
						<TerminalDock />
					</div>
				</section>

				<WorkspaceInspector health={shellHealth} />
			</div>
		</AppFrame>
	);
}

interface WorkspaceInspectorProps {
	health: ShellHealth;
}

function WorkspaceInspector({ health }: WorkspaceInspectorProps) {
	return (
		<aside className='hidden min-h-0 flex-col bg-card lg:flex'>
			<Tabs className='min-h-0 flex-1 gap-0' defaultValue='changes'>
				<div className='flex h-10 shrink-0 items-center border-border border-b px-3'>
					<TabsList className='h-7 rounded-md bg-muted p-0.5' variant='default'>
						<TabsTrigger className='h-6 text-xs' value='files'>
							All files
						</TabsTrigger>
						<TabsTrigger className='h-6 text-xs' value='changes'>
							Changes
						</TabsTrigger>
						<TabsTrigger className='h-6 text-xs' value='checks'>
							Checks
						</TabsTrigger>
					</TabsList>
				</div>

				<TabsContent
					className='min-h-0 flex-1 overflow-y-auto p-3'
					value='files'
				>
					<InspectorSection title='Project files'>
						{changedFiles.map((file) => (
							<InspectorRow
								icon={FileCodeIcon}
								key={file.name}
								label={file.name}
							/>
						))}
					</InspectorSection>
				</TabsContent>

				<TabsContent
					className='min-h-0 flex-1 overflow-y-auto p-3'
					value='changes'
				>
					<InspectorSection title='Working tree'>
						{changedFiles.map((file) => (
							<InspectorRow
								badge={file.status}
								icon={GitBranchIcon}
								key={file.name}
								label={file.name}
							/>
						))}
					</InspectorSection>
				</TabsContent>

				<TabsContent
					className='min-h-0 flex-1 overflow-y-auto p-3'
					value='checks'
				>
					<InspectorSection title='Readiness'>
						<MetricRow
							icon={ActivityIcon}
							label='IPC boundary'
							value={health.state}
						/>
						<MetricRow icon={WrenchIcon} label='Package manager' value='Bun' />
						<MetricRow
							icon={SlidersHorizontalIcon}
							label='Theme source'
							value='Tailwind v4 CSS'
						/>
						<Separator />
						<p className='text-muted-foreground text-xs leading-5'>
							{health.detail}
						</p>
					</InspectorSection>
				</TabsContent>
			</Tabs>
		</aside>
	);
}

interface InspectorSectionProps {
	children: React.ReactNode;
	title: string;
}

function InspectorSection({ children, title }: InspectorSectionProps) {
	return (
		<section className='flex flex-col gap-2'>
			<h2 className='font-medium text-xs'>{title}</h2>
			<div className='flex flex-col gap-1'>{children}</div>
		</section>
	);
}

interface InspectorRowProps {
	badge?: string;
	icon: typeof FileCodeIcon;
	label: string;
}

function InspectorRow({ badge, icon: Icon, label }: InspectorRowProps) {
	return (
		<div className='flex items-center justify-between gap-2 rounded-md px-2 py-1.5 hover:bg-muted'>
			<div className='flex min-w-0 items-center gap-2 text-xs'>
				<Icon
					aria-hidden='true'
					className='size-4 shrink-0 text-muted-foreground'
				/>
				<span className='truncate'>{label}</span>
			</div>
			{badge ? <StatusBadge tone='muted'>{badge}</StatusBadge> : null}
		</div>
	);
}

interface MetricRowProps {
	icon: typeof ActivityIcon;
	label: string;
	value: string;
}

function MetricRow({ icon: Icon, label, value }: MetricRowProps) {
	return (
		<div className='flex items-center justify-between gap-3 rounded-md px-2 py-1.5 hover:bg-muted'>
			<div className='flex items-center gap-2 text-muted-foreground text-xs'>
				<Icon aria-hidden='true' className='size-3.5 shrink-0' />
				<span>{label}</span>
			</div>
			<div className='flex items-center gap-1.5 font-medium text-xs'>
				<CircleDotIcon
					aria-hidden='true'
					className='size-3 shrink-0 text-status-ok'
				/>
				<span>{value}</span>
			</div>
		</div>
	);
}
