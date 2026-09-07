export {
	buildConciergeReferences,
	chatTabReference,
	conciergeReferenceAttachment,
	conciergeReferenceChipKind,
	conciergeReferenceTitle,
	findConciergeReference,
} from './reference-catalog';
export type { ScoredConciergeReference } from './reference-ranking';
export {
	acceptsContiguousMatch,
	closedChatRank,
	rankConciergeReferences,
} from './reference-ranking';
export { conciergeSidebarEdgeLabel } from './sidebar-edge-label';
export { mergeConciergeEvents } from './transcript-merge';
export type { ConciergeFileTarget } from './workspace-file-targets';
export { resolveConciergeFileTarget } from './workspace-file-targets';
