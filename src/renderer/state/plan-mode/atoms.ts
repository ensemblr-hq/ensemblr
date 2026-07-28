/**
 * Plans waiting on the user, keyed by the Pi session that wrote them. Nothing is
 * blocked on a decision — the agent ends its turn as it submits — so a later plan
 * from the same session simply replaces the earlier one, and the map lets several
 * chat tabs hold a plan review at once.
 */
import { atom } from 'jotai';

import type { ExitPlanModeBroadcast } from '@/shared/agent-control';

/** Plan reviews waiting on the user, keyed by Pi session id. */
export const pendingPlanReviewsAtom = atom<
	Readonly<Record<string, ExitPlanModeBroadcast>>
>({});
