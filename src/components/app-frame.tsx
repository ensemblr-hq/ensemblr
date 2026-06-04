import {
	CommandIcon,
	HistoryIcon,
	LayoutDashboardIcon,
	PlusIcon,
} from 'lucide-react';
import type { ComponentType, ReactNode, SVGProps } from 'react';

import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import {
	Sidebar,
	SidebarContent,
	SidebarFooter,
	SidebarGroup,
	SidebarGroupContent,
	SidebarGroupLabel,
	SidebarHeader,
	SidebarInset,
	SidebarMenu,
	SidebarMenuBadge,
	SidebarMenuButton,
	SidebarMenuItem,
	SidebarProvider,
	SidebarRail,
	SidebarSeparator,
	SidebarTrigger,
} from '@/components/ui/sidebar';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { TooltipProvider } from '@/components/ui/tooltip';

export type ShellIcon = ComponentType<SVGProps<SVGSVGElement>>;

export interface ShellRoute<Id extends string = string> {
	badge: string;
	description: string;
	eyebrow: string;
	icon: ShellIcon;
	id: Id;
	label: string;
	title: string;
}

export interface ShellHealth {
	detail: string;
	label: string;
	state: 'online' | 'pending' | 'unavailable';
}

interface AppFrameProps<Id extends string> {
	activeRoute: Id;
	children: ReactNode;
	health: ShellHealth;
	onRouteChange: (route: Id) => void;
	routes: readonly ShellRoute<Id>[];
}

const healthTone: Record<ShellHealth['state'], 'muted' | 'ok' | 'warning'> = {
	online: 'ok',
	pending: 'muted',
	unavailable: 'warning',
};

export function AppFrame<Id extends string>({
	activeRoute,
	children,
	health,
	onRouteChange,
	routes,
}: AppFrameProps<Id>) {
	const active = routes.find((route) => route.id === activeRoute) ?? routes[0];

	function handleRouteValueChange(value: string) {
		const nextRoute = routes.find((route) => route.id === value);

		if (nextRoute) {
			onRouteChange(nextRoute.id);
		}
	}

	return (
		<TooltipProvider>
			<SidebarProvider>
				<Sidebar className='border-sidebar-border' collapsible='offcanvas'>
					<SidebarHeader className='gap-2 border-sidebar-border border-b px-2 pt-2 pb-2'>
						<div
							aria-hidden='true'
							className='macos-traffic-light-spacer h-8 shrink-0'
						/>
						<div className='flex items-center gap-2 rounded-md px-2 py-1.5'>
							<div className='grid size-7 place-items-center rounded-md bg-primary text-primary-foreground'>
								<span className='font-semibold text-[0.6875rem]'>Pi</span>
							</div>
							<div className='min-w-0'>
								<p className='truncate font-medium text-[0.8125rem]'>
									Piductor
								</p>
								<p className='truncate text-[0.6875rem] text-muted-foreground'>
									~/Piductor/workspaces
								</p>
							</div>
						</div>
					</SidebarHeader>

					<SidebarContent>
						<SidebarGroup>
							<SidebarGroupContent>
								<SidebarMenu>
									<SidebarMenuItem>
										<SidebarMenuButton tooltip='Dashboard'>
											<LayoutDashboardIcon aria-hidden='true' />
											<span>Dashboard</span>
										</SidebarMenuButton>
									</SidebarMenuItem>
									<SidebarMenuItem>
										<SidebarMenuButton tooltip='History'>
											<HistoryIcon aria-hidden='true' />
											<span>History</span>
										</SidebarMenuButton>
									</SidebarMenuItem>
								</SidebarMenu>
							</SidebarGroupContent>
						</SidebarGroup>

						<SidebarSeparator />

						<SidebarGroup>
							<SidebarGroupLabel>piductor</SidebarGroupLabel>
							<SidebarGroupContent>
								<SidebarMenu>
									{routes.map((route) => {
										const Icon = route.icon;
										const isActive = route.id === active.id;

										return (
											<SidebarMenuItem key={route.id}>
												<SidebarMenuButton
													isActive={isActive}
													onClick={() => onRouteChange(route.id)}
													tooltip={route.label}
												>
													<Icon aria-hidden='true' />
													<span>{route.label}</span>
												</SidebarMenuButton>
												<SidebarMenuBadge>{route.badge}</SidebarMenuBadge>
											</SidebarMenuItem>
										);
									})}
								</SidebarMenu>
							</SidebarGroupContent>
						</SidebarGroup>
					</SidebarContent>

					<SidebarFooter className='border-sidebar-border border-t p-2'>
						<div className='flex flex-col gap-1 rounded-md px-2 py-1.5'>
							<StatusBadge tone={healthTone[health.state]}>
								{health.label}
							</StatusBadge>
							<p className='line-clamp-2 text-[0.6875rem] text-muted-foreground leading-4'>
								{health.detail}
							</p>
						</div>
					</SidebarFooter>
					<SidebarRail />
				</Sidebar>

				<SidebarInset className='flex h-svh min-h-svh overflow-hidden bg-background text-foreground'>
					<header className='native-toolbar flex h-12 shrink-0 items-center justify-between gap-3 border-border border-b px-3'>
						<div className='flex min-w-0 items-center gap-2'>
							<SidebarTrigger className='md:hidden' />
							<div className='min-w-0'>
								<h1 className='truncate font-semibold text-[0.8125rem]'>
									{active.title}
								</h1>
								<p className='truncate text-[0.6875rem] text-muted-foreground'>
									{active.description}
								</p>
							</div>
						</div>
						<div className='flex shrink-0 items-center gap-2'>
							<Button size='sm' variant='outline'>
								<CommandIcon data-icon='inline-start' />
								Command
							</Button>
							<Button size='icon-sm' variant='default'>
								<PlusIcon />
								<span className='sr-only'>New workspace</span>
							</Button>
						</div>
					</header>

					<div className='flex h-10 shrink-0 items-center border-border border-b bg-background px-3'>
						<RouteTabs
							activeRoute={active.id}
							onValueChange={handleRouteValueChange}
							routes={routes}
						/>
					</div>

					<main className='min-h-0 flex-1 overflow-hidden'>{children}</main>
				</SidebarInset>
			</SidebarProvider>
		</TooltipProvider>
	);
}

interface RouteTabsProps<Id extends string> {
	activeRoute: Id;
	onValueChange: (value: string) => void;
	routes: readonly ShellRoute<Id>[];
}

function RouteTabs<Id extends string>({
	activeRoute,
	onValueChange,
	routes,
}: RouteTabsProps<Id>) {
	return (
		<Tabs className='min-w-0' onValueChange={onValueChange} value={activeRoute}>
			<TabsList
				className='h-7 max-w-full justify-start overflow-x-auto rounded-md bg-muted p-0.5'
				variant='default'
			>
				{routes.map((route) => (
					<TabsTrigger
						className='h-6 min-w-24 rounded-2xl px-3 text-xs'
						key={route.id}
						value={route.id}
					>
						{route.label}
					</TabsTrigger>
				))}
			</TabsList>
		</Tabs>
	);
}
