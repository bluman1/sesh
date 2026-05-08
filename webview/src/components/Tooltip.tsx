import {
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactElement,
  type Ref,
} from "react";

interface TooltipCoords {
  x: number;
  y: number;
  placement: "top" | "bottom";
}

interface Props {
  content: string;
  children: ReactElement;
  placement?: "top" | "bottom";
}

const FLIP_PADDING = 80;

// CSS `::after` tooltips inherit ancestor overflow:hidden and get clipped at
// panel edges. This component portals nothing — it just renders the tooltip
// as a sibling using position:fixed, which sits in the viewport coordinate
// space and can't be clipped by overflow ancestors.
export function Tooltip(props: Props): JSX.Element {
  const { content, children, placement = "top" } = props;
  const [coords, setCoords] = useState<TooltipCoords | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  const compute = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    let p = placement;
    // Flip if there's no room on the preferred side. Heuristic: 80px buffer
    // covers most multi-line tooltips we render.
    if (p === "top" && rect.top < FLIP_PADDING) p = "bottom";
    if (p === "bottom" && window.innerHeight - rect.bottom < FLIP_PADDING) p = "top";
    const y = p === "top" ? rect.top - 6 : rect.bottom + 6;
    const x = rect.left + rect.width / 2;
    setCoords({ x, y, placement: p });
  }, [placement]);

  const hide = useCallback(() => setCoords(null), []);

  // Recompute on scroll / resize so the tooltip tracks the trigger.
  useEffect(() => {
    if (!coords) return;
    const onMove = () => compute();
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
  }, [coords, compute]);

  if (!isValidElement(children)) return children;

  const child = cloneElement(children as ReactElement<{
    ref?: Ref<HTMLElement>;
    onMouseEnter?: () => void;
    onMouseLeave?: () => void;
    onFocus?: () => void;
    onBlur?: () => void;
  }>, {
    ref: (node: HTMLElement | null) => {
      triggerRef.current = node;
    },
    onMouseEnter: compute,
    onMouseLeave: hide,
    onFocus: compute,
    onBlur: hide,
  });

  return (
    <>
      {child}
      {coords && (
        <div
          className={`sesh-tooltip sesh-tooltip-${coords.placement}`}
          style={{ left: coords.x, top: coords.y }}
          role="tooltip"
        >
          {content}
        </div>
      )}
    </>
  );
}
