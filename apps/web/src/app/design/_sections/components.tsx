'use client';

import { Input } from '@/components/ui/input';
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSeparator,
  InputOTPSlot,
} from '@/components/ui/input-otp';
import { Label } from '@/components/ui/label';
import { ThemeToggle } from '@/components/ui/theme-toggle';

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
