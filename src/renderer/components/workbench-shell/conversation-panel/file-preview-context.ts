import { createContext, useContext } from 'react';

/**
 * Opens (or re-focuses) a file-preview tab for a workspace-relative path.
 * Provided by the conversation surface; consumed by attachment chips rendered
 * deep inside the timeline. `null` outside a workspace conversation, so chips
 * degrade to their non-interactive form.
 */
export type FilePreviewOpener = (filePath: string) => void;

const FilePreviewOpenerContext = createContext<FilePreviewOpener | null>(null);

export const FilePreviewOpenerProvider = FilePreviewOpenerContext.Provider;

export function useFilePreviewOpener(): FilePreviewOpener | null {
	return useContext(FilePreviewOpenerContext);
}

/** Opens (or re-focuses) a diff tab for a checkpointed turn. */
export type TurnDiffOpener = (input: { label: string; turnId: string }) => void;

const TurnDiffOpenerContext = createContext<TurnDiffOpener | null>(null);

export const TurnDiffOpenerProvider = TurnDiffOpenerContext.Provider;

export function useTurnDiffOpener(): TurnDiffOpener | null {
	return useContext(TurnDiffOpenerContext);
}
