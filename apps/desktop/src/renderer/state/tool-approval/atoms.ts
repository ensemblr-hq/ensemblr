/**
 * Tool calls waiting on the user, keyed by the Claude session blocked on each.
 * A session blocks inside `canUseTool`, so it has at most one entry; the map
 * lets several chat tabs hold a prompt at once.
 */
import { atom } from 'jotai';

import type { ToolApprovalRequestedBroadcast } from '@/shared/agent-tool-approval';

/** Pending tool-approval prompts, keyed by agent session id. */
export const pendingToolApprovalsAtom = atom<
	Readonly<Record<string, ToolApprovalRequestedBroadcast>>
>({});
