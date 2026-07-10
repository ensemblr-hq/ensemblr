/** Top-level UI states the clone flow moves through. */
export type CloneStage =
	| 'idle'
	| 'preparing'
	| 'cloning'
	| 'opening'
	| 'success'
	| 'failure';
