import {
	CommandIcon,
	MoreHorizontalIcon,
	SearchIcon,
	SlidersHorizontalIcon,
} from 'lucide-react';
import { ShellPanel } from '@/components/shell-panel';
import { StatusBadge } from '@/components/status-badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from '@/components/ui/dialog';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
	Field,
	FieldContent,
	FieldDescription,
	FieldGroup,
	FieldLabel,
	FieldLegend,
	FieldSet,
	FieldTitle,
} from '@/components/ui/field';
import {
	InputGroup,
	InputGroupAddon,
	InputGroupInput,
	InputGroupText,
} from '@/components/ui/input-group';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/components/ui/select';
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetFooter,
	SheetHeader,
	SheetTitle,
	SheetTrigger,
} from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from '@/components/ui/tooltip';

export function DesignSystemPreview() {
	return (
		<ShellPanel
			action={<StatusBadge tone='ok'>Preview</StatusBadge>}
			description='Fixture for generated primitives and semantic tokens before real workspace data is wired.'
			eyebrow='Design system'
			title='Foundation controls'
		>
			<Tabs defaultValue='controls'>
				<div className='flex flex-wrap items-center justify-between gap-2'>
					<TabsList className='h-7 rounded-md bg-muted p-0.5' variant='default'>
						<TabsTrigger className='h-6 text-xs' value='controls'>
							Controls
						</TabsTrigger>
						<TabsTrigger className='h-6 text-xs' value='states'>
							States
						</TabsTrigger>
						<TabsTrigger className='h-6 text-xs' value='overlays'>
							Overlays
						</TabsTrigger>
					</TabsList>
					<div className='flex items-center gap-1.5'>
						<Tooltip>
							<TooltipTrigger asChild>
								<Button size='sm' variant='outline'>
									<CommandIcon data-icon='inline-start' />
									Command palette
								</Button>
							</TooltipTrigger>
							<TooltipContent>Future global command center</TooltipContent>
						</Tooltip>
						<DropdownMenu>
							<DropdownMenuTrigger asChild>
								<Button size='icon-sm' variant='ghost'>
									<MoreHorizontalIcon />
									<span className='sr-only'>Open preview menu</span>
								</Button>
							</DropdownMenuTrigger>
							<DropdownMenuContent>
								<DropdownMenuLabel>Preview actions</DropdownMenuLabel>
								<DropdownMenuSeparator />
								<DropdownMenuGroup>
									<DropdownMenuItem>Reset layout</DropdownMenuItem>
									<DropdownMenuItem>Export token audit</DropdownMenuItem>
								</DropdownMenuGroup>
							</DropdownMenuContent>
						</DropdownMenu>
					</div>
				</div>

				<TabsContent className='pt-3' value='controls'>
					<div className='grid gap-3 lg:grid-cols-[1.1fr_0.9fr]'>
						<FieldGroup className='rounded-md border border-border bg-pane p-3'>
							<Field>
								<FieldLabel htmlFor='workspace-filter'>
									Workspace filter
								</FieldLabel>
								<InputGroup>
									<InputGroupAddon>
										<InputGroupText>
											<SearchIcon />
										</InputGroupText>
									</InputGroupAddon>
									<InputGroupInput
										id='workspace-filter'
										placeholder='Search workspaces, agents, branches'
									/>
								</InputGroup>
								<FieldDescription>
									Search affordance for future project and workspace lists.
								</FieldDescription>
							</Field>

							<Field>
								<FieldLabel htmlFor='agent-notes'>Agent note</FieldLabel>
								<Textarea
									className='min-h-20'
									defaultValue='Keep generated shadcn source separate from product wrappers.'
									id='agent-notes'
								/>
							</Field>

							<div className='grid gap-3 md:grid-cols-2'>
								<Field>
									<FieldLabel>Review style</FieldLabel>
									<Select defaultValue='guarded'>
										<SelectTrigger>
											<SelectValue placeholder='Select style' />
										</SelectTrigger>
										<SelectContent>
											<SelectGroup>
												<SelectItem value='guarded'>Guarded merge</SelectItem>
												<SelectItem value='fast'>Fast path</SelectItem>
												<SelectItem value='audit'>Audit first</SelectItem>
											</SelectGroup>
										</SelectContent>
									</Select>
								</Field>
								<Field>
									<FieldLabel>Density</FieldLabel>
									<ToggleGroup defaultValue='adaptive' type='single'>
										<ToggleGroupItem value='compact'>Compact</ToggleGroupItem>
										<ToggleGroupItem value='adaptive'>Adaptive</ToggleGroupItem>
									</ToggleGroup>
								</Field>
							</div>
						</FieldGroup>

						<FieldSet className='rounded-md border border-border bg-pane p-3'>
							<FieldLegend>Execution defaults</FieldLegend>
							<Field orientation='horizontal'>
								<Switch defaultChecked id='trusted-workspace' />
								<FieldContent>
									<FieldLabel htmlFor='trusted-workspace'>
										Trusted workspace
									</FieldLabel>
									<FieldDescription>
										Allow local execution after repository trust is explicit.
									</FieldDescription>
								</FieldContent>
							</Field>
							<Field orientation='horizontal'>
								<Checkbox defaultChecked id='checkpointing' />
								<FieldContent>
									<FieldLabel htmlFor='checkpointing'>
										Git checkpoints
									</FieldLabel>
									<FieldDescription>
										Create reviewable restore points before risky tool runs.
									</FieldDescription>
								</FieldContent>
							</Field>
							<FieldSet>
								<FieldLegend variant='label'>Merge confirmation</FieldLegend>
								<RadioGroup defaultValue='explicit'>
									<Field orientation='horizontal'>
										<RadioGroupItem id='merge-explicit' value='explicit' />
										<FieldTitle>Explicit every time</FieldTitle>
									</Field>
									<Field orientation='horizontal'>
										<RadioGroupItem id='merge-reviewed' value='reviewed' />
										<FieldTitle>After reviewed checks</FieldTitle>
									</Field>
								</RadioGroup>
							</FieldSet>
						</FieldSet>
					</div>
				</TabsContent>

				<TabsContent className='pt-3' value='states'>
					<div className='grid gap-3 md:grid-cols-3'>
						<Alert className='border-status-ok/30 bg-status-ok/10'>
							<AlertTitle>Ready state</AlertTitle>
							<AlertDescription>
								IPC health and tokens are available.
							</AlertDescription>
						</Alert>
						<Alert className='border-status-warning/30 bg-status-warning/10'>
							<AlertTitle>Needs setup</AlertTitle>
							<AlertDescription>
								Future checks can show missing gh, Git, or Pi CLI setup.
							</AlertDescription>
						</Alert>
						<div className='flex flex-col gap-2 rounded-md border border-border bg-pane p-3'>
							<Skeleton className='h-4 w-2/3' />
							<Skeleton className='h-14' />
							<Skeleton className='h-4 w-1/2' />
						</div>
					</div>
				</TabsContent>

				<TabsContent className='pt-3' value='overlays'>
					<div className='flex flex-wrap gap-2'>
						<Dialog>
							<DialogTrigger asChild>
								<Button>
									<SlidersHorizontalIcon data-icon='inline-start' />
									Open dialog
								</Button>
							</DialogTrigger>
							<DialogContent>
								<DialogHeader>
									<DialogTitle>Design token audit</DialogTitle>
									<DialogDescription>
										Dialog primitives are available for confirmation and review
										flows.
									</DialogDescription>
								</DialogHeader>
								<DialogFooter showCloseButton>
									<Button>Save audit</Button>
								</DialogFooter>
							</DialogContent>
						</Dialog>
						<Sheet>
							<SheetTrigger asChild>
								<Button variant='outline'>Open sheet</Button>
							</SheetTrigger>
							<SheetContent>
								<SheetHeader>
									<SheetTitle>Workspace inspector</SheetTitle>
									<SheetDescription>
										Sheet primitives can host route details without leaving the
										active task.
									</SheetDescription>
								</SheetHeader>
								<div className='px-4 text-muted-foreground text-sm leading-6'>
									Pinned sources, branch state, agent controls, and setup
									warnings can land here later.
								</div>
								<SheetFooter>
									<Button variant='outline'>View roadmap</Button>
								</SheetFooter>
							</SheetContent>
						</Sheet>
					</div>
				</TabsContent>
			</Tabs>
		</ShellPanel>
	);
}
