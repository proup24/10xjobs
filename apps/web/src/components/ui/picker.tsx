'use client';

import * as React from 'react';
import {
  Combobox,
  ComboboxChip,
  ComboboxChips,
  ComboboxChipsInput,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxValue,
  useComboboxAnchor,
} from '@/components/ui/combobox';
import {
  filterOptions,
  PICKER_LIMIT,
  type PickerOption,
} from '@/components/ui/picker-filter';
import { cn } from '@/lib/utils';

export type { PickerOption };

type PickerBaseProps = {
  id?: string;
  options: PickerOption[];
  placeholder: string;
  /** Shown when the search matches nothing. */
  emptyText: string;
  disabled?: boolean;
  className?: string;
  'aria-invalid'?: boolean;
  'aria-label'?: string;
};

type PickerProps = PickerBaseProps & {
  value: string | null;
  onValueChange: (value: string | null) => void;
};

type MultiPickerProps = PickerBaseProps & {
  value: string[];
  onValueChange: (value: string[]) => void;
};

const toLabel = (option: PickerOption) => option.label;
const sameOption = (a: PickerOption, b: PickerOption) => a.value === b.value;

/** Resolve values to options, keeping unknown values visible by their value. */
function useResolve(options: PickerOption[]) {
  const byValue = React.useMemo(
    () => new Map(options.map((option) => [option.value, option])),
    [options],
  );
  return React.useCallback(
    (value: string): PickerOption =>
      byValue.get(value) ?? { value, label: value },
    [byValue],
  );
}

function PickerList({ emptyText }: { emptyText: string }) {
  return (
    <>
      <ComboboxEmpty>{emptyText}</ComboboxEmpty>
      <ComboboxList>
        {(option: PickerOption) => (
          <ComboboxItem
            key={option.value}
            value={option}
            // Without it the name runs label and detail together ("FranceCountry").
            aria-label={
              option.detail ? `${option.label}, ${option.detail}` : undefined
            }
          >
            {option.label}
            {option.detail && (
              <span className="ml-auto text-xs text-muted-foreground">
                {option.detail}
              </span>
            )}
          </ComboboxItem>
        )}
      </ComboboxList>
    </>
  );
}

/**
 * Searchable single choice from a value list. Matching is `filterOptions`
 * (accent-insensitive, keywords, prefix first) and shows at most 50 matches.
 */
function Picker({
  id,
  options,
  value,
  onValueChange,
  placeholder,
  emptyText,
  disabled,
  className,
  'aria-invalid': ariaInvalid,
  'aria-label': ariaLabel,
}: PickerProps) {
  const anchor = useComboboxAnchor();
  const resolve = useResolve(options);
  const [query, setQuery] = React.useState('');
  const selected = value === null ? null : resolve(value);
  const filtered = React.useMemo(
    () => filterOptions(options, query),
    [options, query],
  );

  return (
    <Combobox<PickerOption>
      items={options}
      filteredItems={filtered}
      limit={PICKER_LIMIT}
      value={selected}
      onValueChange={(next) => onValueChange(next?.value ?? null)}
      onInputValueChange={setQuery}
      itemToStringLabel={toLabel}
      isItemEqualToValue={sameOption}
      disabled={disabled}
    >
      <ComboboxInput
        id={id}
        groupRef={anchor}
        className={cn('w-full', className)}
        placeholder={placeholder}
        disabled={disabled}
        showClear={selected !== null && !disabled}
        aria-invalid={ariaInvalid}
        aria-label={ariaLabel}
      />
      <ComboboxContent anchor={anchor}>
        <PickerList emptyText={emptyText} />
      </ComboboxContent>
    </Combobox>
  );
}

/**
 * Searchable multiple choice. Selected values are chips with a remove button;
 * Backspace in the empty search removes the last chip (Base UI handles it).
 * Selected options are not listed again.
 */
function MultiPicker({
  id,
  options,
  value,
  onValueChange,
  placeholder,
  emptyText,
  disabled,
  className,
  'aria-invalid': ariaInvalid,
  'aria-label': ariaLabel,
}: MultiPickerProps) {
  const anchor = useComboboxAnchor();
  const resolve = useResolve(options);
  const [query, setQuery] = React.useState('');
  const selected = React.useMemo(() => value.map(resolve), [value, resolve]);
  const filtered = React.useMemo(() => {
    const taken = new Set(value);
    return filterOptions(
      options.filter((option) => !taken.has(option.value)),
      query,
    );
  }, [options, value, query]);

  return (
    <Combobox<PickerOption, true>
      multiple
      items={options}
      filteredItems={filtered}
      limit={PICKER_LIMIT}
      value={selected}
      onValueChange={(next) =>
        onValueChange(next.map((option) => option.value))
      }
      onInputValueChange={setQuery}
      itemToStringLabel={toLabel}
      isItemEqualToValue={sameOption}
      disabled={disabled}
    >
      <ComboboxChips ref={anchor} className={className}>
        <ComboboxValue>
          {(chips: PickerOption[]) =>
            chips.map((option) => (
              <ComboboxChip
                key={option.value}
                removeLabel={`Remove ${option.label}`}
                showRemove={!disabled}
              >
                {option.label}
              </ComboboxChip>
            ))
          }
        </ComboboxValue>
        <ComboboxChipsInput
          id={id}
          placeholder={selected.length ? undefined : placeholder}
          disabled={disabled}
          aria-invalid={ariaInvalid}
          aria-label={ariaLabel}
        />
      </ComboboxChips>
      <ComboboxContent anchor={anchor}>
        <PickerList emptyText={emptyText} />
      </ComboboxContent>
    </Combobox>
  );
}

export { MultiPicker, Picker };
