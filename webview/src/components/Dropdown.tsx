import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Icon } from "./Icon";

export interface DropdownItem {
  value: string;
  label: string;
  /** Codicon name to render before the label. */
  icon?: string;
  /** Optional grouping — items sharing the same group string are rendered
   * under a single heading in the order they appear. Items with no group
   * are rendered first. */
  group?: string;
  /** Right-aligned secondary text (e.g. count). */
  hint?: string;
  disabled?: boolean;
}

interface Props {
  value: string;
  items: DropdownItem[];
  onChange: (value: string) => void;
  /** Override the trigger's displayed text. Defaults to the selected
   * item's label. */
  triggerLabel?: ReactNode;
  /** Codicon shown to the left of the trigger label. */
  triggerIcon?: string;
  placeholder?: string;
  className?: string;
  /** Fixed minimum width for the menu. Defaults to the trigger width. */
  menuMinWidth?: number;
  /** "left" anchors the menu to the trigger's left edge (default), "right"
   * anchors to its right edge — useful for triggers near the right edge of
   * the panel. */
  align?: "left" | "right";
  title?: string;
}

export function Dropdown(props: Props): JSX.Element {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const selected = props.items.find((i) => i.value === props.value);
  const enabled = useMemo(
    () => props.items.filter((i) => !i.disabled),
    [props.items],
  );

  // Close on click outside / escape, navigate with arrows, commit on enter.
  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      if (triggerRef.current?.contains(e.target as Node)) return;
      if (menuRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((i) => Math.min(enabled.length - 1, i + 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((i) => Math.max(0, i - 1));
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        const item = enabled[activeIndex];
        if (item) {
          props.onChange(item.value);
          setOpen(false);
          triggerRef.current?.focus();
        }
      }
    };
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, activeIndex, enabled, props]);

  // When the menu opens, focus the currently-selected item (or the first).
  useEffect(() => {
    if (!open) return;
    const idx = enabled.findIndex((i) => i.value === props.value);
    setActiveIndex(idx >= 0 ? idx : 0);
  }, [open, enabled, props.value]);

  const grouped = useMemo(() => {
    const order: string[] = [];
    const map = new Map<string, DropdownItem[]>();
    for (const item of props.items) {
      const key = item.group ?? "";
      if (!map.has(key)) {
        order.push(key);
        map.set(key, []);
      }
      map.get(key)!.push(item);
    }
    return order.map((k) => [k, map.get(k)!] as const);
  }, [props.items]);

  return (
    <div className={`sesh-dropdown ${props.className ?? ""}`}>
      <button
        ref={triggerRef}
        type="button"
        className="sesh-dropdown-trigger"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={props.title}
      >
        {props.triggerIcon && (
          <Icon name={props.triggerIcon} className="sesh-dropdown-trigger-icon" />
        )}
        <span className="sesh-dropdown-trigger-label">
          {props.triggerLabel ?? selected?.label ?? props.placeholder ?? ""}
        </span>
        <Icon name="chevron-down" className="sesh-dropdown-chevron" />
      </button>
      {open && (
        <div
          ref={menuRef}
          className={`sesh-dropdown-menu sesh-dropdown-menu-${props.align ?? "left"}`}
          role="listbox"
          style={
            props.menuMinWidth ? { minWidth: props.menuMinWidth } : undefined
          }
        >
          {grouped.map(([groupName, items], gi) => (
            <Fragment key={gi}>
              {groupName && (
                <div className="sesh-dropdown-group-label">{groupName}</div>
              )}
              {items.map((item) => {
                const enabledIndex = enabled.indexOf(item);
                const isActive = enabledIndex === activeIndex;
                const isSelected = item.value === props.value;
                return (
                  <button
                    key={item.value}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    className={`sesh-dropdown-item ${isSelected ? "is-selected" : ""} ${isActive ? "is-active" : ""}`}
                    disabled={item.disabled}
                    onMouseEnter={() =>
                      enabledIndex >= 0 && setActiveIndex(enabledIndex)
                    }
                    onClick={() => {
                      if (item.disabled) return;
                      props.onChange(item.value);
                      setOpen(false);
                      triggerRef.current?.focus();
                    }}
                  >
                    {item.icon && (
                      <Icon name={item.icon} className="sesh-dropdown-item-icon" />
                    )}
                    <span className="sesh-dropdown-item-label">{item.label}</span>
                    {item.hint && (
                      <span className="sesh-dropdown-item-hint">{item.hint}</span>
                    )}
                    {isSelected && (
                      <Icon
                        name="check"
                        className="sesh-dropdown-item-check"
                      />
                    )}
                  </button>
                );
              })}
            </Fragment>
          ))}
        </div>
      )}
    </div>
  );
}
