import { DEMO_UPDATE_FAILURE } from '../fixtures/updates.ts';
import { defineScenario } from '../scenario.ts';
import updateAvailable from './update-available.ts';

/** Navigation sidebar's failed update-check state. */
export default defineScenario({
	...updateAvailable,
	id: 'update-failure',
	label: 'Update — failure',
	updateStatus: DEMO_UPDATE_FAILURE,
});
