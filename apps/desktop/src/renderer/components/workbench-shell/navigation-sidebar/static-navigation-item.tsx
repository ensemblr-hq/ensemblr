import type { ReactElement } from 'react';

import {
	SidebarMenuButton,
	SidebarMenuItem,
} from '@/renderer/components/ui/sidebar';
import { useNavigation } from '@/renderer/components/workbench-shell/shell-contexts';
import type { WorkbenchStaticNavigationTarget } from '@/renderer/types/workbench-shell';

/** Single static-navigation menu entry, wrapped in a router link when supplied. */
export function StaticNavigationItem({
	ariaLabel,
	icon,
	isActive,
	label,
	onPrefetch,
	onSelect,
	target,
}: {
	ariaLabel?: string;
	icon: ReactElement;
	isActive: boolean;
	label: string;
	/** Warms the destination's data on hover or focus, before the click lands. */
	onPrefetch?: () => void;
	onSelect: (target: WorkbenchStaticNavigationTarget) => void;
	target: WorkbenchStaticNavigationTarget;
}) {
	const { renderStaticLink } = useNavigation();
	const content = (
		<>
			{icon}
			<span>{label}</span>
		</>
	);

	return (
		<SidebarMenuItem>
			<SidebarMenuButton
				aria-label={ariaLabel}
				asChild={Boolean(renderStaticLink)}
				isActive={isActive}
				onClick={renderStaticLink ? undefined : () => onSelect(target)}
				onFocus={onPrefetch}
				onPointerEnter={onPrefetch}
				tooltip={label}
			>
				{renderStaticLink ? renderStaticLink(target, content) : content}
			</SidebarMenuButton>
		</SidebarMenuItem>
	);
}
