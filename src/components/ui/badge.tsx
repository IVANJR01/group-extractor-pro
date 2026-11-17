import type { HTMLAttributes } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badge = cva('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap', {
  variants: {
    tone: {
      neutral: 'bg-muted text-muted-foreground border-transparent',
      success: 'bg-accent text-accent-foreground border-transparent',
      warning: 'bg-amber-100 text-amber-800 border-transparent dark:bg-amber-500/15 dark:text-amber-300',
      danger: 'bg-red-100 text-red-700 border-transparent dark:bg-red-500/15 dark:text-red-300',
      info: 'bg-sky-100 text-sky-800 border-transparent dark:bg-sky-500/15 dark:text-sky-300',
      outline: 'bg-transparent',
    },
  },
  defaultVariants: { tone: 'neutral' },
});

export const Badge = ({ className, tone, ...p }: HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badge>) => (
  <span className={cn(badge({ tone }), className)} {...p} />
);
