import { useLayoutEffect } from 'react';

export function useVisualViewport(enabled: boolean) {
  useLayoutEffect(() => {
    if (!enabled) return;
    const root = document.documentElement;
    const viewport = window.visualViewport;
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        root.style.setProperty('--visual-height', `${viewport?.height ?? window.innerHeight}px`);
        root.style.setProperty('--visual-top', `${viewport?.offsetTop ?? 0}px`);
      });
    };
    update();
    window.addEventListener('resize', update);
    viewport?.addEventListener('resize', update);
    viewport?.addEventListener('scroll', update);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', update);
      viewport?.removeEventListener('resize', update);
      viewport?.removeEventListener('scroll', update);
      root.style.removeProperty('--visual-height');
      root.style.removeProperty('--visual-top');
    };
  }, [enabled]);
}
