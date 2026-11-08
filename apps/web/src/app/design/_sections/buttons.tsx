'use client';

import { ArrowRight, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';

const VARIANTS = [
  'default',
  'secondary',
  'outline',
  'dashed',
  'ghost',
  'link',
  'destructive',
] as const;
const SIZES = ['xs', 'sm', 'default', 'lg', 'xl'] as const;
const ICON_SIZES = [
  'icon-xs',
  'icon-sm',
  'icon',
  'icon-lg',
  'icon-xl',
] as const;

function Row({
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

export function ButtonsSection() {
  return (
    <section className="flex flex-col gap-6">
      <h2 className="text-title-3">Buttons</h2>

      {SIZES.map((size) => (
        <Row key={size} title={`Variants, size ${size}`}>
          {VARIANTS.map((variant) => (
            <Button key={variant} variant={variant} size={size}>
              {variant}
            </Button>
          ))}
        </Row>
      ))}

      <Row title="Icon left, right and only">
        {VARIANTS.map((variant) => (
          <Button key={`l-${variant}`} variant={variant}>
            <Plus data-icon="inline-start" />
            {variant}
          </Button>
        ))}
        {VARIANTS.map((variant) => (
          <Button key={`r-${variant}`} variant={variant}>
            {variant}
            <ArrowRight data-icon="inline-end" />
          </Button>
        ))}
      </Row>
      <Row title="Icon-only sizes">
        {ICON_SIZES.map((size) => (
          <Button key={size} size={size} variant="outline" aria-label={size}>
            <Plus />
          </Button>
        ))}
      </Row>

      <Row title="Disabled">
        {VARIANTS.map((variant) => (
          <Button key={variant} variant={variant} disabled>
            {variant}
          </Button>
        ))}
      </Row>
      <Row title="Loading">
        {VARIANTS.map((variant) => (
          <Button key={variant} variant={variant} loading>
            {variant}
          </Button>
        ))}
      </Row>
      <Row title="Invalid">
        <Button aria-invalid>invalid</Button>
      </Row>
    </section>
  );
}
