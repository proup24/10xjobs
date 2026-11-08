'use client';

import { ArrowRight, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Block } from './block';

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

export function ButtonsSection() {
  return (
    <section className="flex flex-col gap-6">
      <h2 className="text-title-3">Buttons</h2>

      {SIZES.map((size) => (
        <Block key={size} title={`Variants, size ${size}`}>
          {VARIANTS.map((variant) => (
            <Button key={variant} variant={variant} size={size}>
              {variant}
            </Button>
          ))}
        </Block>
      ))}

      <Block title="Icon left, right and only">
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
      </Block>
      <Block title="Icon-only sizes">
        {ICON_SIZES.map((size) => (
          <Button key={size} size={size} variant="outline" aria-label={size}>
            <Plus />
          </Button>
        ))}
      </Block>

      <Block title="Disabled">
        {VARIANTS.map((variant) => (
          <Button key={variant} variant={variant} disabled>
            {variant}
          </Button>
        ))}
      </Block>
      <Block title="Loading">
        {VARIANTS.map((variant) => (
          <Button key={variant} variant={variant} loading>
            {variant}
          </Button>
        ))}
      </Block>
      <Block title="Invalid">
        <Button aria-invalid>invalid</Button>
      </Block>
    </section>
  );
}
