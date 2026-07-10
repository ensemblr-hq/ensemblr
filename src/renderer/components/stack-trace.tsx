import { useControllableState } from '@radix-ui/react-use-controllable-state';
import {
	AlertTriangleIcon,
	CheckIcon,
	ChevronDownIcon,
	CopyIcon,
} from 'lucide-react';
import type { ComponentProps } from 'react';
import {
	createContext,
	memo,
	use,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from 'react';
import { Button } from '@/renderer/components/ui/button';
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from '@/renderer/components/ui/collapsible';
import { cn } from '@/renderer/lib/utils';

// Regex patterns for parsing stack traces
const STACK_FRAME_WITH_PARENS_REGEX = /^at\s+(.+?)\s+\((.+):(\d+):(\d+)\)$/;
const STACK_FRAME_WITHOUT_FN_REGEX = /^at\s+(.+):(\d+):(\d+)$/;
const ERROR_TYPE_REGEX = /^(\w+Error|Error):\s*(.*)$/;
const AT_PREFIX_REGEX = /^at\s+/;

/** One parsed stack-trace frame: function, file location, and internal-source flag. */
interface StackFrame {
	raw: string;
	functionName: string | null;
	filePath: string | null;
	lineNumber: number | null;
	columnNumber: number | null;
	isInternal: boolean;
}

/** A parsed stack trace: error type/message plus its individual frames. */
interface ParsedStackTrace {
	errorType: string | null;
	errorMessage: string;
	frames: StackFrame[];
	raw: string;
}

/** Context shared by the {@link StackTrace} compound components. */
interface StackTraceContextValue {
	trace: ParsedStackTrace;
	raw: string;
	isOpen: boolean;
	setIsOpen: (open: boolean) => void;
	onFilePathClick?: (filePath: string, line?: number, column?: number) => void;
}

const StackTraceContext = createContext<StackTraceContextValue | null>(null);

/**
 * Read the stack-trace context, throwing when used outside a {@link StackTrace}.
 * @returns The active stack-trace context value
 */
const useStackTrace = () => {
	const context = use(StackTraceContext);
	if (!context) {
		throw new Error('StackTrace components must be used within StackTrace');
	}
	return context;
};

/**
 * Parse a single stack-trace line into structured frame data, flagging internal
 * (node/node_modules) frames.
 * @param line - One raw stack-trace line
 * @returns The parsed frame; location fields are null when the line is unparseable
 */
const parseStackFrame = (line: string): StackFrame => {
	const trimmed = line.trim();

	// Pattern: at functionName (filePath:line:column)
	const withParensMatch = trimmed.match(STACK_FRAME_WITH_PARENS_REGEX);
	if (withParensMatch) {
		const [, functionName, filePath, lineNum, colNum] = withParensMatch;
		const isInternal =
			filePath.includes('node_modules') ||
			filePath.startsWith('node:') ||
			filePath.includes('internal/');
		return {
			columnNumber: colNum ? Number.parseInt(colNum, 10) : null,
			filePath: filePath ?? null,
			functionName: functionName ?? null,
			isInternal,
			lineNumber: lineNum ? Number.parseInt(lineNum, 10) : null,
			raw: trimmed,
		};
	}

	// Pattern: at filePath:line:column (no function name)
	const withoutFnMatch = trimmed.match(STACK_FRAME_WITHOUT_FN_REGEX);
	if (withoutFnMatch) {
		const [, filePath, lineNum, colNum] = withoutFnMatch;
		const isInternal =
			(filePath?.includes('node_modules') ?? false) ||
			(filePath?.startsWith('node:') ?? false) ||
			(filePath?.includes('internal/') ?? false);
		return {
			columnNumber: colNum ? Number.parseInt(colNum, 10) : null,
			filePath: filePath ?? null,
			functionName: null,
			isInternal,
			lineNumber: lineNum ? Number.parseInt(lineNum, 10) : null,
			raw: trimmed,
		};
	}

	// Fallback: unparseable line
	return {
		columnNumber: null,
		filePath: null,
		functionName: null,
		isInternal: trimmed.includes('node_modules') || trimmed.includes('node:'),
		lineNumber: null,
		raw: trimmed,
	};
};

/**
 * Parse raw stack-trace text into its error type, message, and frames.
 * @param trace - Full stack-trace string
 * @returns The parsed stack trace
 */
const parseStackTrace = (trace: string): ParsedStackTrace => {
	const lines = trace.split('\n').filter((line) => line.trim());

	if (lines.length === 0) {
		return {
			errorMessage: trace,
			errorType: null,
			frames: [],
			raw: trace,
		};
	}

	const firstLine = lines[0].trim();
	let errorType: string | null = null;
	let errorMessage = firstLine;

	// Try to extract error type from "ErrorType: message" format
	const errorMatch = firstLine.match(ERROR_TYPE_REGEX);
	if (errorMatch) {
		const [, type, msg] = errorMatch;
		errorType = type;
		errorMessage = msg || '';
	}

	// Parse stack frames (lines starting with "at")
	const frames = lines
		.slice(1)
		.flatMap((line) =>
			line.trim().startsWith('at ') ? [parseStackFrame(line)] : [],
		);

	return {
		errorMessage,
		errorType,
		frames,
		raw: trace,
	};
};

/** Props for the {@link StackTrace} root: the raw trace text plus open-state controls and a file-path click handler. */
export type StackTraceProps = ComponentProps<'div'> & {
	trace: string;
	open?: boolean;
	defaultOpen?: boolean;
	onOpenChange?: (open: boolean) => void;
	onFilePathClick?: (filePath: string, line?: number, column?: number) => void;
};

/** Root of the stack-trace compound component: parses the trace and provides collapsible context to its parts. */
export const StackTrace = memo(
	({
		trace,
		className,
		open,
		defaultOpen = false,
		onOpenChange,
		onFilePathClick,
		children,
		...props
	}: StackTraceProps) => {
		const [isOpen, setIsOpen] = useControllableState({
			defaultProp: defaultOpen,
			onChange: onOpenChange,
			prop: open,
		});

		const parsedTrace = useMemo(() => parseStackTrace(trace), [trace]);

		const contextValue = useMemo(
			() => ({
				isOpen,
				onFilePathClick,
				raw: trace,
				setIsOpen,
				trace: parsedTrace,
			}),
			[parsedTrace, trace, isOpen, setIsOpen, onFilePathClick],
		);

		return (
			<StackTraceContext.Provider value={contextValue}>
				<Collapsible onOpenChange={setIsOpen} open={isOpen}>
					<div
						className={cn(
							'not-prose w-full overflow-hidden rounded-lg border bg-background font-mono text-sm',
							className,
						)}
						{...props}
					>
						{children}
					</div>
				</Collapsible>
			</StackTraceContext.Provider>
		);
	},
);

/** Props for the stack-trace header, mirroring the collapsible trigger. */
export type StackTraceHeaderProps = ComponentProps<typeof CollapsibleTrigger>;

/** Clickable header row that toggles the stack-trace's collapsible content. */
export const StackTraceHeader = memo(
	({ className, children, ...props }: StackTraceHeaderProps) => (
		<CollapsibleTrigger asChild {...props}>
			<div
				className={cn(
					'flex w-full cursor-pointer items-center gap-3 p-3 text-left transition-colors hover:bg-muted/50',
					className,
				)}
			>
				{children}
			</div>
		</CollapsibleTrigger>
	),
);

/** Props for the stack-trace error summary row. */
export type StackTraceErrorProps = ComponentProps<'div'>;

/** Error summary row with a warning icon, holding the error type and message. */
export const StackTraceError = memo(
	({ className, children, ...props }: StackTraceErrorProps) => (
		<div
			className={cn(
				'flex flex-1 items-center gap-2 overflow-hidden',
				className,
			)}
			{...props}
		>
			<AlertTriangleIcon className='size-4 shrink-0 text-destructive' />
			{children}
		</div>
	),
);

/** Props for the stack-trace error-type label. */
export type StackTraceErrorTypeProps = ComponentProps<'span'>;

/** Renders the parsed error type, defaulting to the trace's own type. */
export const StackTraceErrorType = memo(
	({ className, children, ...props }: StackTraceErrorTypeProps) => {
		const { trace } = useStackTrace();

		return (
			<span
				className={cn('shrink-0 font-semibold text-destructive', className)}
				{...props}
			>
				{children ?? trace.errorType}
			</span>
		);
	},
);

/** Props for the stack-trace error-message label. */
export type StackTraceErrorMessageProps = ComponentProps<'span'>;

/** Renders the parsed error message, defaulting to the trace's own message. */
export const StackTraceErrorMessage = memo(
	({ className, children, ...props }: StackTraceErrorMessageProps) => {
		const { trace } = useStackTrace();

		return (
			<span className={cn('truncate text-foreground', className)} {...props}>
				{children ?? trace.errorMessage}
			</span>
		);
	},
);

/** Props for the stack-trace actions toolbar. */
export type StackTraceActionsProps = ComponentProps<'fieldset'>;

/**
 * Stop a click from bubbling to the collapsible header so action buttons don't toggle it.
 * @param e - The originating mouse event
 */
const handleActionsClick = (e: React.MouseEvent) => e.stopPropagation();
/**
 * Stop Enter/Space key activations from bubbling to the collapsible header.
 * @param e - The originating keyboard event
 */
const handleActionsKeyDown = (e: React.KeyboardEvent) => {
	if (e.key === 'Enter' || e.key === ' ') {
		e.stopPropagation();
	}
};

/** Action toolbar that keeps its buttons from toggling the collapsible header. */
export const StackTraceActions = memo(
	({ className, children, ...props }: StackTraceActionsProps) => (
		<fieldset
			className={cn(
				'm-0 flex shrink-0 items-center gap-1 border-0 p-0',
				className,
			)}
			onClick={handleActionsClick}
			onKeyDown={handleActionsKeyDown}
			{...props}
		>
			{children}
		</fieldset>
	),
);

/** Props for the stack-trace copy button, including copy/error callbacks and the copied-state timeout. */
export type StackTraceCopyButtonProps = ComponentProps<typeof Button> & {
	onCopy?: () => void;
	onError?: (error: Error) => void;
	timeout?: number;
};

/** Button that copies the raw stack trace to the clipboard, briefly showing a check icon. */
export const StackTraceCopyButton = memo(
	({
		onCopy,
		onError,
		timeout = 2000,
		className,
		children,
		...props
	}: StackTraceCopyButtonProps) => {
		const [isCopied, setIsCopied] = useState(false);
		const timeoutRef = useRef<number>(0);
		const { raw } = useStackTrace();

		const copyToClipboard = useCallback(async () => {
			if (typeof window === 'undefined' || !navigator?.clipboard?.writeText) {
				onError?.(new Error('Clipboard API not available'));
				return;
			}

			try {
				await navigator.clipboard.writeText(raw);
				setIsCopied(true);
				onCopy?.();
				timeoutRef.current = window.setTimeout(
					() => setIsCopied(false),
					timeout,
				);
			} catch (error) {
				onError?.(error as Error);
			}
		}, [raw, onCopy, onError, timeout]);

		useEffect(
			() => () => {
				window.clearTimeout(timeoutRef.current);
			},
			[],
		);

		const Icon = isCopied ? CheckIcon : CopyIcon;

		return (
			<Button
				className={cn('size-7', className)}
				onClick={copyToClipboard}
				size='icon'
				variant='ghost'
				{...props}
			>
				{children ?? <Icon size={14} />}
			</Button>
		);
	},
);

/** Props for the stack-trace expand chevron. */
export type StackTraceExpandButtonProps = ComponentProps<'div'>;

/** Chevron affordance that rotates to reflect the open/closed state. */
export const StackTraceExpandButton = memo(
	({ className, ...props }: StackTraceExpandButtonProps) => {
		const { isOpen } = useStackTrace();

		return (
			<div
				className={cn('flex size-7 items-center justify-center', className)}
				{...props}
			>
				<ChevronDownIcon
					className={cn(
						'size-4 text-muted-foreground transition-transform',
						isOpen ? 'rotate-180' : 'rotate-0',
					)}
				/>
			</div>
		);
	},
);

/** Props for the collapsible stack-trace content, including an optional max height. */
export type StackTraceContentProps = ComponentProps<
	typeof CollapsibleContent
> & {
	maxHeight?: number;
};

/** Scrollable collapsible body revealed when the stack trace is expanded. */
export const StackTraceContent = memo(
	({
		className,
		maxHeight = 400,
		children,
		...props
	}: StackTraceContentProps) => (
		<CollapsibleContent
			className={cn(
				'overflow-auto border-t bg-muted/30',
				'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=open]:animate-in',
				className,
			)}
			style={{ maxHeight }}
			{...props}
		>
			{children}
		</CollapsibleContent>
	),
);

/** Props for the stack-trace frames list, including whether to show internal frames. */
export type StackTraceFramesProps = ComponentProps<'div'> & {
	showInternalFrames?: boolean;
};

/** Props for the clickable file-path button in a stack frame. */
interface FilePathButtonProps {
	frame: StackFrame;
	onFilePathClick?: (
		filePath: string,
		lineNumber?: number,
		columnNumber?: number,
	) => void;
}

/** Clickable file path that opens the frame's source location when clicked. */
const FilePathButton = memo(
	({ frame, onFilePathClick }: FilePathButtonProps) => {
		const handleClick = useCallback(() => {
			if (frame.filePath) {
				onFilePathClick?.(
					frame.filePath,
					frame.lineNumber ?? undefined,
					frame.columnNumber ?? undefined,
				);
			}
		}, [frame, onFilePathClick]);

		return (
			<button
				className={cn(
					'underline decoration-dotted hover:text-primary',
					onFilePathClick && 'cursor-pointer',
				)}
				disabled={!onFilePathClick}
				onClick={handleClick}
				type='button'
			>
				{frame.filePath}
				{frame.lineNumber !== null && `:${frame.lineNumber}`}
				{frame.columnNumber !== null && `:${frame.columnNumber}`}
			</button>
		);
	},
);

FilePathButton.displayName = 'FilePathButton';

/** Renders the parsed stack frames, optionally hiding internal ones and linking file paths. */
export const StackTraceFrames = memo(
	({
		className,
		showInternalFrames = true,
		...props
	}: StackTraceFramesProps) => {
		const { trace, onFilePathClick } = useStackTrace();

		const framesToShow = showInternalFrames
			? trace.frames
			: trace.frames.filter((f) => !f.isInternal);

		return (
			<div className={cn('space-y-1 p-3', className)} {...props}>
				{framesToShow.map((frame) => (
					<div
						className={cn(
							'text-xs',
							frame.isInternal
								? 'text-muted-foreground/50'
								: 'text-foreground/90',
						)}
						key={frame.raw}
					>
						<span className='text-muted-foreground'>at </span>
						{frame.functionName && (
							<span className={frame.isInternal ? '' : 'text-foreground'}>
								{frame.functionName}{' '}
							</span>
						)}
						{frame.filePath && (
							<>
								<span className='text-muted-foreground'>(</span>
								<FilePathButton
									frame={frame}
									onFilePathClick={onFilePathClick}
								/>
								<span className='text-muted-foreground'>)</span>
							</>
						)}
						{!(frame.filePath || frame.functionName) && (
							<span>{frame.raw.replace(AT_PREFIX_REGEX, '')}</span>
						)}
					</div>
				))}
				{framesToShow.length === 0 && (
					<div className='text-muted-foreground text-xs'>No stack frames</div>
				)}
			</div>
		);
	},
);

StackTrace.displayName = 'StackTrace';
StackTraceHeader.displayName = 'StackTraceHeader';
StackTraceError.displayName = 'StackTraceError';
StackTraceErrorType.displayName = 'StackTraceErrorType';
StackTraceErrorMessage.displayName = 'StackTraceErrorMessage';
StackTraceActions.displayName = 'StackTraceActions';
StackTraceCopyButton.displayName = 'StackTraceCopyButton';
StackTraceExpandButton.displayName = 'StackTraceExpandButton';
StackTraceContent.displayName = 'StackTraceContent';
StackTraceFrames.displayName = 'StackTraceFrames';
