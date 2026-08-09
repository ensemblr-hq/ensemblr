import { cn } from '@/renderer/lib/utils';

import { SCENE_GROUPS, type SceneId } from './scene-catalog.tsx';

/** The left sidebar's scene list, grouped by the surface each scene belongs to. */
export function SceneNav({
	onSceneChange,
	sceneId,
}: {
	onSceneChange: (id: SceneId) => void;
	sceneId: SceneId;
}) {
	return (
		<nav className='flex flex-col gap-4'>
			{SCENE_GROUPS.map((group) => (
				<div className='flex flex-col gap-0.5' key={group.label}>
					<span className='px-2 pb-1 font-mono text-muted-foreground text-xxs uppercase tracking-wide'>
						{group.label}
					</span>
					{group.scenes.map((scene) => (
						<SceneNavItem
							isActive={scene.id === sceneId}
							key={scene.id}
							label={scene.label}
							onClick={() => onSceneChange(scene.id)}
						/>
					))}
				</div>
			))}
		</nav>
	);
}

/** One scene entry, filling the sidebar's width so the whole row is the target. */
function SceneNavItem({
	isActive,
	label,
	onClick,
}: {
	isActive: boolean;
	label: string;
	onClick: () => void;
}) {
	return (
		<button
			className={cn(
				'rounded-md px-2 py-1 text-left font-mono text-xxs transition-colors',
				isActive
					? 'bg-surface text-foreground'
					: 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
			)}
			onClick={onClick}
			type='button'
		>
			{label}
		</button>
	);
}
