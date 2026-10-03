/**
 * Linear workflow-state types that mean nobody has picked an issue up: Backlog
 * and Todo. Matched on the state's `type` rather than its name, which every team
 * renames freely. Shared because both ends need the same set — main asks Linear
 * for exactly these issues, and the renderer filters the board and the
 * create-from picker on them — and two copies would drift.
 */
export const LINEAR_NOT_STARTED_STATE_TYPES: readonly string[] = [
	'backlog',
	'unstarted',
];
