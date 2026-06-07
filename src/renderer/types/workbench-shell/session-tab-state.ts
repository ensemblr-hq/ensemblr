import type { SessionTabModel } from '@/renderer/types/workbench';

export interface SessionTabState {
	closedSessions: SessionTabModel[];
	closeSessionTab: (sessionId: string) => void;
	effectiveActiveSession: SessionTabModel;
	restoreSessionTab: (sessionId: string) => void;
	sessionTabs: SessionTabModel[];
}
