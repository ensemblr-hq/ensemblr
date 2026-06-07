import { createFileRoute, Link } from '@tanstack/react-router';
import { ArrowLeftIcon } from 'lucide-react';

import { Button } from '@/renderer/components/ui/button';
import { useRouteProfilerMount } from '@/renderer/lib/instrumentation/route-profiler';

export const Route = createFileRoute('/_workbench/settings')({
	component: SettingsRoute,
	staticData: {
		workbenchView: 'settings',
	},
});

/** Full-screen settings route rendered outside the workbench shell layout. */
function SettingsRoute() {
	useRouteProfilerMount('SettingsRoute');

	return (
		<main className='flex h-svh min-h-svh flex-col bg-background text-foreground'>
			<header className='macos-traffic-light-spacer flex h-12 shrink-0 items-center gap-2 border-b px-3'>
				<Button asChild size='sm' variant='ghost'>
					<Link preload='intent' to='/'>
						<ArrowLeftIcon aria-hidden='true' />
						<span>Back</span>
					</Link>
				</Button>
			</header>
			<section className='flex min-h-0 flex-1 items-center justify-center px-8 py-10'>
				<div className='max-w-md text-center'>
					<h1 className='font-semibold text-2xl tracking-normal'>Settings</h1>
					<p className='mt-3 text-muted-foreground text-sm leading-6'>
						Settings are not connected yet.
					</p>
				</div>
			</section>
		</main>
	);
}
