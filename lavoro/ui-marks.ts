import * as React from 'react';
import { annotate, annotationGroup } from 'rough-notation';
import type { MarkKind } from './format.ts';

// Hand-drawn marks over the words of the description (16q). The words carry `data-mark`; this draws one annotation per
// word once the detail has settled, as one group so they draw in turn and only once. The summary at the top says the
// same in text, so every SVG is aria-hidden.

// The package does not re-export its model types, so they come from the function that uses them.
type Annotation = ReturnType<typeof annotate>;
type AnnotationConfig = Parameters<typeof annotate>[1];

const rootStyle = () => getComputedStyle(document.documentElement);
const color = (token: string) => rootStyle().getPropertyValue(token).trim();
/** A rem token as pixels: the desk raises the root font size, so a stroke follows the rest of the interface. */
function px(token: string) {
  const value = rootStyle().getPropertyValue(token).trim();
  return value.endsWith('rem') ? parseFloat(value) * parseFloat(rootStyle().fontSize) : parseFloat(value);
}

function configOf(kind: MarkKind, animate: boolean): AnnotationConfig {
  const stroke = px('--spacing-3xs');
  const base = { animate, strokeWidth: stroke, padding: px('--spacing-3xs') };
  if (kind === 'exclude')
    return { ...base, type: 'circle', color: color('--danger'), padding: px('--spacing-2xs'), animationDuration: 450 };
  if (kind === 'salary')
    return { ...base, type: 'underline', color: color('--success'), multiline: true, animationDuration: 350 };
  if (kind === 'contract')
    return { ...base, type: 'underline', color: color('--accent'), multiline: true, animationDuration: 350 };
  return {
    ...base,
    type: 'underline',
    color: color('--muted-foreground'),
    strokeWidth: stroke / 2,
    iterations: 1,
    multiline: true,
    animationDuration: 150,
  };
}

const isMarkKind = (value: string | undefined): value is MarkKind =>
  value === 'exclude' || value === 'salary' || value === 'contract' || value === 'skill';

/** The dialog plays an entry transition, and a rect measured mid-transform is wrong: wait until it has finished. */
function settled(root: HTMLElement) {
  const dialog = root.closest('dialog');
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const running = dialog?.getAnimations({ subtree: true }) ?? [];
        void Promise.allSettled(running.map((animation) => animation.finished)).then(() => resolve());
      }),
    );
  });
}

/** Draws the marks inside `ref` while `active`, and again when `version` (the markup) changes; removes them all otherwise. */
export function useDescriptionMarks(ref: React.RefObject<HTMLElement | null>, active: boolean, version: string) {
  React.useEffect(() => {
    const root = ref.current;
    if (!root || !active) return;
    let cancelled = false;
    let drawn: Annotation[] = [];
    void settled(root).then(() => {
      if (cancelled) return;
      const animate = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      for (const word of root.querySelectorAll<HTMLElement>('[data-mark]')) {
        const kind = word.dataset.mark;
        if (isMarkKind(kind)) drawn.push(annotate(word, configOf(kind, animate)));
      }
      annotationGroup(drawn).show();
      for (const svg of root.querySelectorAll('svg.rough-annotation')) svg.setAttribute('aria-hidden', 'true');
    });
    return () => {
      cancelled = true;
      for (const annotation of drawn) annotation.remove();
      drawn = [];
    };
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- version encodes active highlight markup and key. // guard-private: allow Generic lint rule name
  }, [ref, active, version]);
}
