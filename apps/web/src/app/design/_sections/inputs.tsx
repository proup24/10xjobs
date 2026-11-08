'use client';

import { Mail, Star } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from '@/components/ui/input-group';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Toggle } from '@/components/ui/toggle';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Block } from './block';

const LEVELS = [
  { value: 'junior', label: 'Junior' },
  { value: 'mid', label: 'Mid' },
  { value: 'senior', label: 'Senior' },
];

function Field({
  id,
  label,
  children,
}: {
  id: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}

function Choice({
  id,
  label,
  children,
}: {
  id: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2">
      {children}
      <Label htmlFor={id}>{label}</Label>
    </div>
  );
}

export function InputsSection() {
  return (
    <section className="flex flex-col gap-6">
      <h2 className="text-title-3">Inputs and choice controls</h2>
      <p className="text-sm text-muted-foreground">
        Focus: the border turns brand green and a 3px brand ring appears (tab to
        a control to see it). Invalid is set with aria-invalid.
      </p>

      <Block title="Input">
        <div className="grid w-full max-w-sm gap-3">
          <Field id="i-default" label="Default">
            <Input id="i-default" placeholder="you@example.com" />
          </Field>
          <Field id="i-value" label="With value">
            <Input id="i-value" defaultValue="Senior engineer" />
          </Field>
          <Field id="i-disabled" label="Disabled">
            <Input id="i-disabled" disabled defaultValue="Disabled" />
          </Field>
          <Field id="i-invalid" label="Invalid">
            <Input id="i-invalid" aria-invalid defaultValue="not an email" />
          </Field>
        </div>
      </Block>

      <Block title="Input group, leading icon">
        <div className="grid w-full max-w-sm gap-3">
          <Field id="g-default" label="Default">
            <InputGroup>
              <InputGroupAddon>
                <Mail />
              </InputGroupAddon>
              <InputGroupInput id="g-default" placeholder="you@example.com" />
            </InputGroup>
          </Field>
          <Field id="g-disabled" label="Disabled">
            <InputGroup>
              <InputGroupAddon>
                <Mail />
              </InputGroupAddon>
              <InputGroupInput
                id="g-disabled"
                disabled
                defaultValue="Disabled"
              />
            </InputGroup>
          </Field>
          <Field id="g-invalid" label="Invalid">
            <InputGroup>
              <InputGroupAddon>
                <Mail />
              </InputGroupAddon>
              <InputGroupInput
                id="g-invalid"
                aria-invalid
                defaultValue="not an email"
              />
            </InputGroup>
          </Field>
        </div>
      </Block>

      <Block title="Textarea">
        <div className="grid w-full max-w-sm gap-3">
          <Field id="t-default" label="Default">
            <Textarea id="t-default" placeholder="Notes" />
          </Field>
          <Field id="t-disabled" label="Disabled">
            <Textarea id="t-disabled" disabled defaultValue="Disabled" />
          </Field>
          <Field id="t-invalid" label="Invalid">
            <Textarea id="t-invalid" aria-invalid defaultValue="Too short" />
          </Field>
        </div>
      </Block>

      <Block title="Checkbox: unchecked, checked, disabled, invalid">
        <Choice id="c-off" label="Unchecked">
          <Checkbox id="c-off" />
        </Choice>
        <Choice id="c-on" label="Checked">
          <Checkbox id="c-on" defaultChecked />
        </Choice>
        <Choice id="c-disabled" label="Disabled">
          <Checkbox id="c-disabled" disabled />
        </Choice>
        <Choice id="c-disabled-on" label="Disabled checked">
          <Checkbox id="c-disabled-on" disabled defaultChecked />
        </Choice>
        <Choice id="c-invalid" label="Invalid">
          <Checkbox id="c-invalid" aria-invalid />
        </Choice>
      </Block>

      <Block title="Radio group: default, disabled, invalid">
        <RadioGroup defaultValue="mid" className="w-auto">
          {LEVELS.map((l) => (
            <Choice key={l.value} id={`r-${l.value}`} label={l.label}>
              <RadioGroupItem id={`r-${l.value}`} value={l.value} />
            </Choice>
          ))}
        </RadioGroup>
        <RadioGroup defaultValue="mid" disabled className="w-auto">
          <Choice id="rd-mid" label="Disabled checked">
            <RadioGroupItem id="rd-mid" value="mid" />
          </Choice>
          <Choice id="rd-off" label="Disabled">
            <RadioGroupItem id="rd-off" value="senior" />
          </Choice>
        </RadioGroup>
        <RadioGroup className="w-auto" aria-label="Invalid">
          <Choice id="ri-a" label="Invalid">
            <RadioGroupItem id="ri-a" value="a" aria-invalid />
          </Choice>
        </RadioGroup>
      </Block>

      <Block title="Switch: off, on, disabled, invalid">
        <Choice id="s-off" label="Off">
          <Switch id="s-off" />
        </Choice>
        <Choice id="s-on" label="On">
          <Switch id="s-on" defaultChecked />
        </Choice>
        <Choice id="s-disabled" label="Disabled">
          <Switch id="s-disabled" disabled />
        </Choice>
        <Choice id="s-invalid" label="Invalid">
          <Switch id="s-invalid" aria-invalid />
        </Choice>
        <Choice id="s-sm" label="Small">
          <Switch id="s-sm" size="sm" defaultChecked />
        </Choice>
      </Block>

      <Block title="Toggle: unpressed, pressed, disabled">
        <Toggle aria-label="Search for this, unpressed" variant="outline">
          <Star />
        </Toggle>
        <Toggle
          aria-label="Search for this, pressed"
          variant="outline"
          defaultPressed
        >
          <Star />
        </Toggle>
        <Toggle
          aria-label="Search for this, disabled"
          variant="outline"
          disabled
        >
          <Star />
        </Toggle>
        <Toggle size="sm">Small</Toggle>
      </Block>

      <Block title="Toggle group: Remote, Hybrid and On-site, multiple">
        <ToggleGroup multiple defaultValue={['remote']} variant="outline">
          <ToggleGroupItem value="remote">Remote</ToggleGroupItem>
          <ToggleGroupItem value="hybrid" disabled>
            Hybrid
          </ToggleGroupItem>
          <ToggleGroupItem value="onsite" disabled>
            On-site
          </ToggleGroupItem>
        </ToggleGroup>
      </Block>

      <Block title="Select: default, disabled, invalid">
        <Select items={LEVELS} defaultValue="mid">
          <SelectTrigger className="w-40" aria-label="Level">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {LEVELS.map((l) => (
              <SelectItem key={l.value} value={l.value}>
                {l.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select items={LEVELS} defaultValue="mid" disabled>
          <SelectTrigger className="w-40" aria-label="Level, disabled">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {LEVELS.map((l) => (
              <SelectItem key={l.value} value={l.value}>
                {l.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select items={LEVELS}>
          <SelectTrigger
            className="w-40"
            aria-label="Level, invalid"
            aria-invalid
          >
            <SelectValue placeholder="Pick a level" />
          </SelectTrigger>
          <SelectContent>
            {LEVELS.map((l) => (
              <SelectItem key={l.value} value={l.value}>
                {l.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Block>
    </section>
  );
}
