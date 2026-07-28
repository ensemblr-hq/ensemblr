import type { Edge } from '@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge';

import type {
	ProjectShellModel,
	WorkspaceShellModel,
} from '@/renderer/types/workbench';
import type { WorkspaceBoardStatusValue } from '@/shared/agent-control';

/** A workspace paired with the project it belongs to, for board rendering. */
export interface BoardCard {
	project: ProjectShellModel;
	workspace: WorkspaceShellModel;
}

/** A resolved board drop: the moved card and where it landed. */
export interface BoardDrop {
	edge: Edge | null;
	sourceId: string;
	targetCardId: string | null;
	targetColumnStatus: WorkspaceBoardStatusValue | null;
}
