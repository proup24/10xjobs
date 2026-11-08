import { Briefcase } from 'lucide-react';

export function Brand() {
  return (
    <span className="flex items-center gap-2 font-medium">
      <span className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
        <Briefcase className="size-4" aria-hidden />
      </span>
      10xjobs
    </span>
  );
}
