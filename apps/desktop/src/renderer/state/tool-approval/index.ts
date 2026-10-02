/**
 * Public surface of the pending tool-approval state: the sync effect the app
 * root installs, plus the per-chat read and answer hooks.
 */
export { pendingToolApprovalsAtom } from './atoms.ts';
export {
	useAnswerToolApproval,
	usePendingToolApproval,
	useToolApprovalSync,
} from './pending-approvals.ts';
