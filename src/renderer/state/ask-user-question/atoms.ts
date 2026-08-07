/**
 * Pending agent questionnaires, keyed by the agent session that asked. An agent
 * blocks on its `askUserQuestion` call, so a session has at most one entry; the
 * map lets several chat tabs hold questions at once.
 */
import { atom } from 'jotai';

import type { AskUserQuestionBroadcast } from '@/shared/agent-control';

/** Questionnaires waiting on the user, keyed by agent session id. */
export const pendingAskUserQuestionsAtom = atom<
	Readonly<Record<string, AskUserQuestionBroadcast>>
>({});
