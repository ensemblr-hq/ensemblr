import type { LucideIcon } from 'lucide-react';

export type WorkspaceSidebarStateKind =
	| 'branch'
	| 'pr-blocked'
	| 'pr-checking'
	| 'pr-merged'
	| 'pr-open'
	| 'pr-ready'
	| 'pr-working'
	| 'workspace-blocked'
	| 'workspace-checking'
	| 'workspace-working';

export interface WorkspaceSidebarState {
	className: string;
	icon: LucideIcon;
	isSpinning?: boolean;
	kind: WorkspaceSidebarStateKind;
}
