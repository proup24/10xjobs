'use client';

import { useEffect, useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from '@/components/ui/input-group';
import { Mail } from 'lucide-react';
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from '@/components/ui/input-otp';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { EXPIRED_INVITE_HINT } from '@/lib/auth/copy';
import { requestCodeAction, verifyCodeAction } from './actions';

const RESEND_SECONDS = 60;

export function SignInForm() {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sentMessage, setSentMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (secondsLeft <= 0) return;
    const timer = setTimeout(() => setSecondsLeft((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [secondsLeft]);

  function request() {
    setError(null);
    startTransition(async () => {
      const result = await requestCodeAction(email);
      if (result.status === 'invalid') {
        setError(result.message);
        return;
      }
      setSentMessage(result.message);
      setSecondsLeft(RESEND_SECONDS);
    });
  }

  function verify(value: string) {
    setError(null);
    startTransition(async () => {
      const result = await verifyCodeAction(email, value);
      if (result && !result.ok) {
        setError(result.message);
        setCode('');
      }
    });
  }

  if (sentMessage === null) {
    return (
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          request();
        }}
      >
        <Field invalid={error !== null}>
          <FieldLabel htmlFor="email">Email</FieldLabel>
          <InputGroup>
            <InputGroupAddon>
              <Mail aria-hidden />
            </InputGroupAddon>
            <InputGroupInput
              id="email"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </InputGroup>
          <FieldError>{error}</FieldError>
        </Field>
        <Button type="submit" size="lg" className="w-full" loading={pending}>
          Send code
        </Button>
      </form>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <p role="status">{sentMessage}</p>
      <p className="text-xs text-muted-foreground">{EXPIRED_INVITE_HINT}</p>
      <Field invalid={error !== null}>
        <FieldLabel htmlFor="code">6-digit code</FieldLabel>
        <InputOTP
          id="code"
          maxLength={6}
          value={code}
          onChange={setCode}
          onComplete={verify}
          disabled={pending}
        >
          <InputOTPGroup>
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <InputOTPSlot key={i} index={i} />
            ))}
          </InputOTPGroup>
        </InputOTP>
        <FieldError>{error}</FieldError>
      </Field>
      <Button
        type="button"
        variant="outline"
        size="lg"
        className="w-full"
        loading={pending}
        disabled={secondsLeft > 0}
        onClick={request}
      >
        {secondsLeft > 0
          ? `Send a new code (${secondsLeft}s)`
          : 'Send a new code'}
      </Button>
    </div>
  );
}
