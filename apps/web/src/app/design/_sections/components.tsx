'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSeparator,
  InputOTPSlot,
} from '@/components/ui/input-otp';
import { Label } from '@/components/ui/label';
import { ThemeToggle } from '@/components/ui/theme-toggle';

const VARIANTS = [
  'default',
  'outline',
  'secondary',
  'ghost',
  'destructive',
  'link',
] as const;
const SIZES = ['xs', 'sm', 'default', 'lg'] as const;
const ICON_SIZES = ['icon-xs', 'icon-sm', 'icon', 'icon-lg'] as const;

function Block({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-title-5">{title}</h3>
      <div className="flex flex-wrap items-center gap-3">{children}</div>
    </div>
  );
}

export function ComponentsSection() {
  return (
    <section className="flex flex-col gap-6">
      <h2 className="text-title-3">Components</h2>

      <Block title="Button variants">
        {VARIANTS.map((variant) => (
          <Button key={variant} variant={variant}>
            {variant}
          </Button>
        ))}
      </Block>
      <Block title="Button sizes">
        {SIZES.map((size) => (
          <Button key={size} size={size}>
            {size}
          </Button>
        ))}
        {ICON_SIZES.map((size) => (
          <Button key={size} size={size} variant="outline" aria-label={size}>
            +
          </Button>
        ))}
      </Block>
      <Block title="Button states">
        <Button disabled>disabled</Button>
        <Button aria-invalid>invalid</Button>
        <Button variant="outline" disabled>
          disabled outline
        </Button>
      </Block>

      <Block title="Input">
        <div className="grid w-full max-w-sm gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="d-default">Default</Label>
            <Input id="d-default" placeholder="you@example.com" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="d-value">With value</Label>
            <Input id="d-value" defaultValue="Senior engineer" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="d-disabled">Disabled</Label>
            <Input id="d-disabled" disabled defaultValue="Disabled" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="d-invalid">Invalid</Label>
            <Input id="d-invalid" aria-invalid defaultValue="not an email" />
          </div>
        </div>
      </Block>

      <Block title="Input OTP">
        <InputOTP maxLength={6} aria-label="One-time code">
          <InputOTPGroup>
            <InputOTPSlot index={0} />
            <InputOTPSlot index={1} />
            <InputOTPSlot index={2} />
          </InputOTPGroup>
          <InputOTPSeparator />
          <InputOTPGroup>
            <InputOTPSlot index={3} />
            <InputOTPSlot index={4} />
            <InputOTPSlot index={5} />
          </InputOTPGroup>
        </InputOTP>
      </Block>

      <Block title="Theme toggle">
        <ThemeToggle />
      </Block>
    </section>
  );
}
