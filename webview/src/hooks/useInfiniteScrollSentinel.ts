import { useEffect, useRef, type RefObject } from "react";

/**
 * Attach the returned ref to a small sentinel element placed at the bottom of
 * a paginated list. When the sentinel scrolls within `rootMargin` of the
 * nearest scrollable ancestor's edge AND `enabled` is true, `onIntersect`
 * fires once. The caller is responsible for setting `enabled` to false while
 * a fetch is in flight to debounce repeated triggers.
 */
export function useInfiniteScrollSentinel(
  onIntersect: () => void,
  enabled: boolean,
): RefObject<HTMLDivElement> {
  const ref = useRef<HTMLDivElement>(null);
  const cb = useRef(onIntersect);
  cb.current = onIntersect;

  useEffect(() => {
    if (!enabled) return;
    const el = ref.current;
    if (!el) return;
    const root = findScrollParent(el);
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) cb.current();
      },
      { root: root ?? null, rootMargin: "200px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [enabled]);

  return ref;
}

function findScrollParent(el: HTMLElement): HTMLElement | null {
  let parent: HTMLElement | null = el.parentElement;
  while (parent) {
    const style = getComputedStyle(parent);
    if (
      (style.overflowY === "auto" || style.overflowY === "scroll") &&
      parent.scrollHeight > parent.clientHeight
    ) {
      return parent;
    }
    parent = parent.parentElement;
  }
  return null;
}
