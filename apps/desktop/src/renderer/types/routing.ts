import type { QueryClient } from '@tanstack/react-query';

import type {
	WorkbenchShellData,
	WorkspaceShellData,
} from '@/renderer/types/workbench';

export interface RouterContext {
	queryClient: QueryClient;
}

export interface WorkspaceRouteParams {
	projectId: string;
	workspaceId: string;
}

export interface WorkspaceChatRouteParams extends WorkspaceRouteParams {
	chatId: string;
}

export interface ProjectRouteParams {
	projectId: string;
}

export type WorkbenchRouteLoaderData = WorkbenchShellData;
export type WorkspaceRouteLoaderData = WorkspaceShellData;
