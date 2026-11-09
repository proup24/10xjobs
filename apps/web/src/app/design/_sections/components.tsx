'use client';

import {
  InputOTP,
  InputOTPGroup,
  InputOTPSeparator,
  InputOTPSlot,
} from '@/components/ui/input-otp';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { ThemeToggle } from '@/components/ui/theme-toggle';
import { VerticalNav } from '@/components/ui/vertical-nav';
import { Block } from './block';

const navGroups = [
  {
    label: 'You',
    items: [
      { href: '#vertical-nav', label: 'About you', current: true },
      { href: '#vertical-nav-contacts', label: 'Contacts' },
    ],
  },
  {
    label: 'Profiles',
    items: [
      {
        href: '#vertical-nav-backend',
        label: 'Backend',
        badge: 'Draft',
        children: [{ href: '#vertical-nav-roles', label: 'Roles' }],
      },
      { href: '#vertical-nav-frontend', label: 'Frontend' },
    ],
    action: (
      <Button variant="outline" size="sm" className="w-full">
        New profile
      </Button>
    ),
  },
];

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

      <Block title="Vertical nav">
        <div className="w-full max-w-60">
          <VerticalNav groups={navGroups} label="Example sections" />
        </div>
      </Block>

      <Block title="Theme toggle">
        <ThemeToggle />
      </Block>
    </section>
  );
}
