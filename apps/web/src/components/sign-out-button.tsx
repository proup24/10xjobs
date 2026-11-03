import { Button } from '@/components/ui/button';

export function SignOutButton() {
  return (
    <form method="post" action="/auth/sign-out">
      <Button type="submit" variant="outline">
        Sign out
      </Button>
    </form>
  );
}
