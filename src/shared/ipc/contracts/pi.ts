export interface PiExecutableSelectionResult {
	canceled: boolean;
	error?: string;
	selectedPath?: string;
}

/** Pi runtime / executable IPC surface (locate the Pi binary, etc). */
export interface PiApi {
	selectPiExecutable: () => Promise<PiExecutableSelectionResult>;
}
