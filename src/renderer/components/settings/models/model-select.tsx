import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/renderer/components/ui/select';
import type { AgentModelOption } from '@/shared/ipc/contracts/agent-models';

/** Select dropdown for choosing a model from the visible list; disabled when no models are available. */
export function ModelSelect({
	ariaLabel,
	models,
	onChange,
	placeholder,
	value,
}: {
	ariaLabel: string;
	models: readonly AgentModelOption[];
	onChange: (next: string | null) => void;
	placeholder: string;
	value: string | null;
}) {
	const disabled = models.length === 0;
	return (
		<Select
			disabled={disabled}
			onValueChange={(next) => onChange(next || null)}
			value={value ?? ''}
		>
			<SelectTrigger aria-label={ariaLabel} className='w-44' size='sm'>
				<SelectValue placeholder={placeholder} />
			</SelectTrigger>
			<SelectContent>
				{models.map((model) => (
					<SelectItem key={model.id} value={model.id}>
						{model.displayName}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}
