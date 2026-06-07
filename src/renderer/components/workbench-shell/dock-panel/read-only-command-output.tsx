import { LogDockContent } from './log-content';

/** Read-only output stream used by Setup/Run tabs. */
export function ReadOnlyCommandOutput({
	lines,
	title,
}: {
	lines: string[];
	title: string;
}) {
	return <LogDockContent isReadOnly lines={lines} title={title} />;
}
