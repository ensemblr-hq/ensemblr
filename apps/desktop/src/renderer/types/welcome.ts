/** Top-level UI states the clone flow moves through. */
export type CloneStage =
	| 'idle'
	| 'preparing'
	| 'cloning'
	| 'opening'
	| 'success'
	| 'failure';

/**
 * The branch the clone dialog was pointed at. `cloneBranch` is the bare name
 * `git clone --branch` receives, and is null for a ref typed by hand — a tag or
 * another remote's branch is not a valid `--branch` argument, so such a ref only
 * sets the repository's `branchFrom`. `branchFrom` is always the ref persisted
 * as that setting.
 */
export interface CloneBranchSelection {
	branchFrom: string;
	cloneBranch: string | null;
}
