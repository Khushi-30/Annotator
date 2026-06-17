import { useEffect, useMemo, useRef } from 'react';

export function useDebouncedCallback<A extends any[]>(fn: (...a: A) => void, delay: number) {
  const ref = useRef(fn);
  useEffect(() => { ref.current = fn; }, [fn]);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  const debounced = useMemo(
    () => (...args: A) => {
      clearTimeout(timer.current);
      timer.current = setTimeout(() => ref.current(...args), delay);
    },
    [delay],
  );

  // flush on unmount so an in-flight edit isn't dropped on image change
  useEffect(() => () => clearTimeout(timer.current), []);
  return debounced;
}
