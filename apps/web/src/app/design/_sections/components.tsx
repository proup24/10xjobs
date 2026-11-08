'use client';

import {
  InputOTP,
  InputOTPGroup,
  InputOTPSeparator,
  InputOTPSlot,
} from '@/components/ui/input-otp';
import { Label } from '@/components/ui/label';
import { ThemeToggle } from '@/components/ui/theme-toggle';
import { Block } from './block';

export function ComponentsSection() {
  return (
    <section className="flex flex-col gap-6">
      <h2 className="text-title-3">Components</h2>

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

      <Block title="Label">
        <Label>Label text</Label>
      </Block>

      <Block title="Theme toggle">
        <ThemeToggle />
      </Block>
    </section>
  );
}
