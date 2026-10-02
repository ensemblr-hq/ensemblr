import type { QueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { ensemblrQueryKeys } from '@/renderer/api/ensemblr-queries';
import { createPlaygroundQueryClient } from './playground-query-client.ts';

/**
 * Query client holding one workspace file's read result on top of the shared
 * playground cache, so a scene can drive the shipped file and diff panels —
 * toolbar included — without the Electron preload bridge behind them.
 * @param workspaceCwd - Workspace the file is read from
 * @param filePath - Repo-relative path the panel is pointed at
 * @param content - File body the seeded read returns
 * @returns A query client with that file's preview already cached
 */
export function useSeededFileClient(
	workspaceCwd: string,
	filePath: string,
	content: string,
): QueryClient {
	const [client] = useState(() => {
		const seeded = createPlaygroundQueryClient();
		seeded.setQueryData(ensemblrQueryKeys.filePreview(workspaceCwd, filePath), {
			content,
			contentEncoding: 'utf8',
			path: filePath,
			sizeBytes: content.length,
		});
		return seeded;
	});
	return client;
}
