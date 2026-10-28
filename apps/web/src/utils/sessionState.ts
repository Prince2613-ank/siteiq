import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';

export function readSession<T>(key: string): T | undefined {
  try {
    const value = sessionStorage.getItem(`siteiq:view:v1:${key}`);
    return value === null ? undefined : JSON.parse(value) as T;
  } catch { return undefined; }
}

export function writeSession(key: string, value: unknown): void {
  try { sessionStorage.setItem(`siteiq:view:v1:${key}`, JSON.stringify(value)); } catch { /* Storage may be unavailable. */ }
}

export function useSessionState<T>(key: string, initial: T): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => {
    const saved = readSession<T>(key);
    return saved === undefined ? initial : saved;
  });
  useEffect(() => { writeSession(key, value); }, [key, value]);
  return [value, setValue];
}

export function useRememberScroll(key: string, selector?: string, ready = true): void {
  const initial = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!ready) return;
    const element = selector ? document.querySelector<HTMLElement>(selector) : null;
    if (selector && !element) return;
    initial.current = readSession<number>(key) ?? 0;
    let restoring = true;
    const save = () => {
      if (!restoring) writeSession(key, element ? element.scrollTop : window.scrollY);
    };
    const frame = requestAnimationFrame(() => {
      if (element) element.scrollTop = initial.current ?? 0;
      else window.scrollTo(0, initial.current ?? 0);
      restoring = false;
    });
    const target = element ?? window;
    target.addEventListener('scroll', save, { passive: true });
    window.addEventListener('pagehide', save);
    return () => {
      cancelAnimationFrame(frame);
      save();
      target.removeEventListener('scroll', save);
      window.removeEventListener('pagehide', save);
    };
  }, [key, selector, ready]);
}
