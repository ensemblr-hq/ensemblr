import { defineScenario } from '../scenario.ts';
import workspaceMidTurn from './workspace-mid-turn.ts';

/**
 * `workspace-mid-turn` in the light theme, and nothing else.
 *
 * Written as a spread of the dark scenario rather than a second copy of it so
 * the claim the pair makes — that the only difference is the theme — is enforced
 * by the code instead of by whoever edits one of them next. Everything the shot
 * is worth checking is downstream of that one field: xterm reads its palette off
 * the document rather than a prop, Shiki picks its theme the same way, and the
 * traffic lights and title bar are drawn against the window's own chrome.
 */
export default defineScenario({
	...workspaceMidTurn,
	id: 'workspace-mid-turn-light',
	label: 'Workspace, mid-turn — light',
	theme: 'light',
});
