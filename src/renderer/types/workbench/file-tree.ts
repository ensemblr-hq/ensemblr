/** A directory node in a workspace file tree: nested directories plus files. */
export interface FileTreeNode<TFile> {
	directories: FileTreeNode<TFile>[];
	files: TFile[];
	/** True when git ignores this directory; the all-files tree dims it. */
	isIgnored?: boolean;
	name: string;
	path: string;
}

/** A single visible row of a flattened file tree, ready for windowed render. */
export type FlatFileTreeRow<TFile> =
	| {
			isExpanded: boolean;
			isIgnored: boolean;
			/** Stable React key + toggle target: the compacted node's path. */
			key: string;
			labelParts: string[];
			level: number;
			node: FileTreeNode<TFile>;
			type: 'directory';
	  }
	| {
			file: TFile;
			/** Stable React key: the file's (unique) path. */
			key: string;
			level: number;
			type: 'file';
	  };
