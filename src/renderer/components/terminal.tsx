import Ansi from 'ansi-to-react';
import { CheckIcon, CopyIcon, TerminalIcon, Trash2Icon } from 'lucide-react';
import type { ComponentProps, HTMLAttributes } from 'react';
import {
	createContext,
	use,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from 'react';
import { Button } from '@/renderer/components/ui/button';
import { cn } from '@/renderer/lib/utils';

/** Shared state for the Terminal compound components. */
interface TerminalContextType {
	output: string;
	isStreaming: boolean;
	autoScroll: boolean;
	onClear?: () => void;
}

const TerminalContext = createContext<TerminalContextType>({
	autoScroll: true,
	isStreaming: false,
	output: '',
});

/** Props for the terminal header row. */
type TerminalHeaderProps = HTMLAttributes<HTMLDivElement>;

/** Header row for the terminal, holding the title, status, and actions. */
const TerminalHeader = ({
	className,
	children,
	...props
}: TerminalHeaderProps) => (
	<div
		className={cn(
			'flex items-center justify-between border-zinc-800 border-b px-4 py-2',
			className,
		)}
		{...props}
	>
		{children}
	</div>
);

/** Props for the terminal title. */
type TerminalTitleProps = HTMLAttributes<HTMLDivElement>;

/** Terminal title with a leading terminal icon, defaulting to "Terminal". */
const TerminalTitle = ({
	className,
	children,
	...props
}: TerminalTitleProps) => (
	<div
		className={cn('flex items-center gap-2 text-sm text-zinc-400', className)}
		{...props}
	>
		<TerminalIcon className='size-4' />
		{children ?? 'Terminal'}
	</div>
);

/** Props for the terminal status indicator. */
type TerminalStatusProps = HTMLAttributes<HTMLDivElement>;

/** Status area shown only while the terminal is streaming output. */
const TerminalStatus = ({
	className,
	children,
	...props
}: TerminalStatusProps) => {
	const { isStreaming } = use(TerminalContext);

	if (!isStreaming) {
		return null;
	}

	return (
		<div
			className={cn('flex items-center gap-2 text-xs text-zinc-400', className)}
			{...props}
		>
			{children}
		</div>
	);
};

/** Props for the terminal actions cluster. */
type TerminalActionsProps = HTMLAttributes<HTMLDivElement>;

/** Container for the terminal's trailing action buttons. */
const TerminalActions = ({
	className,
	children,
	...props
}: TerminalActionsProps) => (
	<div className={cn('flex items-center gap-1', className)} {...props}>
		{children}
	</div>
);

/** Props for the terminal copy button, including copy/error callbacks and the copied-state timeout. */
type TerminalCopyButtonProps = ComponentProps<typeof Button> & {
	onCopy?: () => void;
	onError?: (error: Error) => void;
	timeout?: number;
};

/** Button that copies the terminal output to the clipboard, briefly showing a check icon. */
const TerminalCopyButton = ({
	onCopy,
	onError,
	timeout = 2000,
	children,
	className,
	...props
}: TerminalCopyButtonProps) => {
	const [isCopied, setIsCopied] = useState(false);
	const timeoutRef = useRef<number>(0);
	const { output } = use(TerminalContext);

	const copyToClipboard = useCallback(async () => {
		if (typeof window === 'undefined' || !navigator?.clipboard?.writeText) {
			onError?.(new Error('Clipboard API not available'));
			return;
		}

		try {
			await navigator.clipboard.writeText(output);
			setIsCopied(true);
			onCopy?.();
			timeoutRef.current = window.setTimeout(() => setIsCopied(false), timeout);
		} catch (error) {
			onError?.(error as Error);
		}
	}, [output, onCopy, onError, timeout]);

	useEffect(
		() => () => {
			window.clearTimeout(timeoutRef.current);
		},
		[],
	);

	const Icon = isCopied ? CheckIcon : CopyIcon;

	return (
		<Button
			className={cn(
				'size-7 shrink-0 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100',
				className,
			)}
			onClick={copyToClipboard}
			size='icon'
			variant='ghost'
			{...props}
		>
			{children ?? <Icon size={14} />}
		</Button>
	);
};

/** Props for the terminal clear button. */
type TerminalClearButtonProps = ComponentProps<typeof Button>;

/** Button that clears the terminal; hidden when no clear handler is provided. */
const TerminalClearButton = ({
	children,
	className,
	...props
}: TerminalClearButtonProps) => {
	const { onClear } = use(TerminalContext);

	if (!onClear) {
		return null;
	}

	return (
		<Button
			className={cn(
				'size-7 shrink-0 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100',
				className,
			)}
			onClick={onClear}
			size='icon'
			variant='ghost'
			{...props}
		>
			{children ?? <Trash2Icon size={14} />}
		</Button>
	);
};

/** Props for the terminal content area. */
type TerminalContentProps = HTMLAttributes<HTMLDivElement>;

/** Scrollable output area that renders ANSI text and auto-scrolls to the newest line while streaming. */
const TerminalContent = ({
	className,
	children,
	...props
}: TerminalContentProps) => {
	const { output, isStreaming, autoScroll } = use(TerminalContext);
	const containerRef = useRef<HTMLDivElement>(null);

	// biome-ignore lint/correctness/useExhaustiveDependencies: scroll fires on output change; the body reads scrollHeight rather than output directly.
	useEffect(() => {
		if (autoScroll && containerRef.current) {
			containerRef.current.scrollTop = containerRef.current.scrollHeight;
		}
	}, [output, autoScroll]);

	return (
		<div
			className={cn(
				'max-h-96 overflow-auto p-4 font-mono text-sm leading-relaxed',
				className,
			)}
			ref={containerRef}
			{...props}
		>
			{children ?? (
				<pre className='whitespace-pre-wrap break-words'>
					<Ansi>{output}</Ansi>
					{isStreaming && (
						<span className='ml-0.5 inline-block h-4 w-2 animate-pulse bg-zinc-100' />
					)}
				</pre>
			)}
		</div>
	);
};

/** Props for the Terminal root, including the output text and streaming/auto-scroll flags. */
type TerminalProps = HTMLAttributes<HTMLDivElement> & {
	output: string;
	isStreaming?: boolean;
	autoScroll?: boolean;
	onClear?: () => void;
};

/** Root terminal component that provides output context and renders a default header/content layout. */
export const Terminal = ({
	output,
	isStreaming = false,
	autoScroll = true,
	onClear,
	className,
	children,
	...props
}: TerminalProps) => {
	const contextValue = useMemo(
		() => ({ autoScroll, isStreaming, onClear, output }),
		[autoScroll, isStreaming, onClear, output],
	);

	return (
		<TerminalContext.Provider value={contextValue}>
			<div
				className={cn(
					'flex flex-col overflow-hidden rounded-lg border bg-zinc-950 text-zinc-100',
					className,
				)}
				{...props}
			>
				{children ?? (
					<>
						<TerminalHeader>
							<TerminalTitle />
							<div className='flex items-center gap-1'>
								<TerminalStatus />
								<TerminalActions>
									<TerminalCopyButton />
									{onClear && <TerminalClearButton />}
								</TerminalActions>
							</div>
						</TerminalHeader>
						<TerminalContent />
					</>
				)}
			</div>
		</TerminalContext.Provider>
	);
};
