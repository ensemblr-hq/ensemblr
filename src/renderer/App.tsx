import type { ReactElement } from 'react';
import { useEffect, useMemo, useState } from 'react';

import type { HealthSnapshot } from '../shared/ipc';

type RouteId = 'dashboard' | 'setup' | 'workspace' | 'settings';

interface RouteDefinition {
	description: string;
	eyebrow: string;
	label: string;
	title: string;
}

const ROUTES: Record<RouteId, RouteDefinition> = {
	dashboard: {
		description:
			'Project and workspace overview placeholder for the future repository list.',
		eyebrow: 'App shell',
		label: 'Dashboard',
		title: 'Piductor workspace control',
	},
	setup: {
		description:
			'Readiness checks will validate Git, gh, Pi RPC, local commands, and config.',
		eyebrow: 'Setup gate',
		label: 'Setup',
		title: 'Preflight checks before agent work',
	},
	workspace: {
		description:
			'Workspace route placeholder for Pi sessions, terminal dock, and review flow.',
		eyebrow: 'Workspace',
		label: 'Workspace',
		title: 'Isolated task surface',
	},
	settings: {
		description:
			'App, repository, provider, integration, and security settings will land here.',
		eyebrow: 'Settings',
		label: 'Settings',
		title: 'Configuration with visible sources',
	},
};

const routeOrder: RouteId[] = ['dashboard', 'setup', 'workspace', 'settings'];

export function App(): ReactElement {
	const [activeRoute, setActiveRoute] = useState<RouteId>('dashboard');
	const [health, setHealth] = useState<HealthSnapshot | null>(null);
	const [healthError, setHealthError] = useState<string | null>(null);

	useEffect(() => {
		let isMounted = true;

		window.piductor
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

	const route = ROUTES[activeRoute];
	const healthLabel = useMemo(() => {
		if (health) {
			return `${health.appName} IPC online`;
		}

		if (healthError) {
			return 'IPC unavailable';
		}

		return 'Checking IPC';
	}, [health, healthError]);

	return (
		<main className='min-h-screen bg-canvas text-ink'>
			<div className='grid min-h-screen grid-cols-[280px_1fr] max-lg:grid-cols-1'>
				<aside className='border-ink/10 border-r bg-pane px-5 py-6 max-lg:border-r-0 max-lg:border-b'>
					<div className='mb-8'>
						<p className='font-semibold text-rust text-xs uppercase tracking-[0.3em]'>
							Piductor
						</p>
						<h1 className='mt-3 font-semibold text-3xl text-ink tracking-tight'>
							Pi workbench scaffold
						</h1>
					</div>

					<nav className='space-y-2' aria-label='Primary'>
						{routeOrder.map((routeId) => {
							const item = ROUTES[routeId];
							const isActive = routeId === activeRoute;

							return (
								<button
									className='nav-item'
									data-active={isActive}
									key={routeId}
									onClick={() => setActiveRoute(routeId)}
									type='button'
								>
									<span>{item.label}</span>
									<small>{item.eyebrow}</small>
								</button>
							);
						})}
					</nav>

					<section className='mt-8 rounded-2xl border border-ink/10 bg-white/70 p-4 shadow-soft'>
						<p className='font-semibold text-ink/50 text-xs uppercase tracking-[0.2em]'>
							Health endpoint
						</p>
						<p className='mt-2 font-semibold text-sm'>{healthLabel}</p>
						<p className='mt-1 text-ink/60 text-xs'>
							{health
								? `Electron ${health.versions.electron} on ${health.platform}`
								: (healthError ??
									'Renderer is calling the typed preload bridge.')}
						</p>
					</section>
				</aside>

				<section className='relative overflow-hidden px-8 py-7 max-sm:px-4'>
					<div className='absolute inset-0 -z-10 bg-radial-warm' />
					<div className='mx-auto flex max-w-5xl flex-col gap-6'>
						<header className='rounded-[2rem] border border-ink/10 bg-white/75 p-7 shadow-soft backdrop-blur'>
							<p className='font-semibold text-rust text-sm uppercase tracking-[0.28em]'>
								{route.eyebrow}
							</p>
							<div className='mt-4 grid gap-5 lg:grid-cols-[1fr_260px] lg:items-end'>
								<div>
									<h2 className='font-semibold text-5xl text-ink tracking-[-0.05em] max-sm:text-4xl'>
										{route.title}
									</h2>
									<p className='mt-4 max-w-2xl text-ink/68 text-lg leading-8'>
										{route.description}
									</p>
								</div>
								<div className='rounded-2xl bg-ink p-4 text-stone-50'>
									<p className='text-stone-300 text-xs uppercase tracking-[0.24em]'>
										Current issue
									</p>
									<p className='mt-2 font-semibold text-2xl'>THE-101</p>
									<p className='mt-1 text-sm text-stone-300'>
										Electron app shell scaffold
									</p>
								</div>
							</div>
						</header>

						<div className='grid gap-5 md:grid-cols-3'>
							<StatusCard
								detail='Electron main owns lifecycle, menu wiring, and native boundaries.'
								label='Main process'
								value='Ready'
							/>
							<StatusCard
								detail='Preload exposes a typed health bridge with context isolation on.'
								label='IPC boundary'
								value={health ? 'Online' : 'Pending'}
							/>
							<StatusCard
								detail='React renderer has placeholder routes and Tailwind token styling.'
								label='Renderer'
								value='Mounted'
							/>
						</div>

						<section className='rounded-[2rem] border border-ink/10 bg-white/70 p-6 shadow-soft backdrop-blur'>
							<h3 className='font-semibold text-xl'>Foundation scope</h3>
							<div className='mt-4 grid gap-3 text-ink/70 text-sm md:grid-cols-2'>
								<ChecklistItem text='Development scripts for Forge start/package/make' />
								<ChecklistItem text='Typed health IPC endpoint for future app services' />
								<ChecklistItem text='Setup, workspace, dashboard, and settings placeholders' />
								<ChecklistItem text='Tailwind v4 renderer pipeline with project-owned tokens' />
							</div>
						</section>
					</div>
				</section>
			</div>
		</main>
	);
}

function StatusCard({
	detail,
	label,
	value,
}: {
	detail: string;
	label: string;
	value: string;
}): ReactElement {
	return (
		<article className='rounded-3xl border border-ink/10 bg-white/80 p-5 shadow-soft'>
			<p className='font-semibold text-ink/45 text-xs uppercase tracking-[0.22em]'>
				{label}
			</p>
			<p className='mt-3 font-semibold text-3xl tracking-tight'>{value}</p>
			<p className='mt-3 text-ink/65 text-sm leading-6'>{detail}</p>
		</article>
	);
}

function ChecklistItem({ text }: { text: string }): ReactElement {
	return (
		<div className='flex items-center gap-3 rounded-2xl border border-ink/10 bg-cream/70 px-4 py-3'>
			<span className='size-2 rounded-full bg-rust' />
			<span>{text}</span>
		</div>
	);
}
