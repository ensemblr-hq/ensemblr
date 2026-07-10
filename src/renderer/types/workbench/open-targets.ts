import type { WorkspaceOpenTarget } from './workspace';

/**
 * Snapshot the open-in menu reads to render. `openTargets` is `null` while
 * detection results are still loading so the component can paint nothing
 * (no flash) and `primaryTarget` shares the same null-while-loading shape.
 */
/** Optional sub-path to open instead of the workspace root. */
export interface OpenTargetPathOptions {
	relativePath: string;
	relativePathKind: 'directory' | 'file';
}

/** Open-in menu snapshot: the invoke action plus detected and primary targets (`null` while loading). */
export interface OpenTargetsState {
	invokeTarget: (
		target: WorkspaceOpenTarget,
		options?: OpenTargetPathOptions,
	) => Promise<void>;
	openTargets: WorkspaceOpenTarget[] | null;
	primaryTarget: WorkspaceOpenTarget | null;
}
