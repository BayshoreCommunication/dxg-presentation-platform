"use client";

import { Fragment, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@/components/Icon";

export type SelectMenuOption<T extends string> = {
  value: T;
  label: string;
  group?: string;
  icon?: ReactNode;
};

export function SelectMenu<T extends string>({
  label,
  value,
  options,
  onChange,
  placeholder = "Choose an option…",
  disabled = false,
  required = false,
  id,
  title,
  className = "",
}: {
  label: string;
  value: T | "";
  options: readonly SelectMenuOption<T>[];
  onChange: (value: T) => void;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  id?: string;
  title?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [listStyle, setListStyle] = useState<CSSProperties>({});
  const [contentWidth, setContentWidth] = useState({ trigger: 0, menu: 0 });
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const sizer = useRef<HTMLSpanElement>(null);
  const listId = useId();
  const selectedIndex = options.findIndex((option) => option.value === value);
  const selected = selectedIndex >= 0 ? options[selectedIndex] : undefined;

  useEffect(() => {
    let alive = true;
    const measure = () => {
      const button = trigger.current;
      const probes = sizer.current;
      if (!alive || !button || !probes) return;
      const widest = Math.max(0, ...Array.from(probes.querySelectorAll<HTMLElement>(":scope > span:not(.select-menu-group)"), (probe) => probe.getBoundingClientRect().width));
      const groups = Math.max(0, ...Array.from(probes.querySelectorAll<HTMLElement>(":scope > .select-menu-group"), (probe) => probe.getBoundingClientRect().width));
      const style = getComputedStyle(button);
      const arrow = button.lastElementChild?.getBoundingClientRect().width ?? 16;
      const inset = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight) + parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth);
      const next = {
        trigger: Math.ceil(widest + inset + arrow + (parseFloat(style.columnGap) || 0)),
        // List padding/borders, option padding, and space for the selected checkmark.
        menu: Math.ceil(Math.max(widest + 67, groups + 14)),
      };
      setContentWidth((current) => current.trigger === next.trigger && current.menu === next.menu ? current : next);
    };
    measure();
    void document.fonts.ready.then(measure);
    document.fonts.addEventListener("loadingdone", measure);
    return () => {
      alive = false;
      document.fonts.removeEventListener("loadingdone", measure);
    };
  }, [options, placeholder, className]);

  useEffect(() => {
    const close = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!root.current?.contains(target) && !list.current?.contains(target)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);

  useEffect(() => {
    if (open) setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
  }, [open, selectedIndex]);

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = trigger.current?.getBoundingClientRect();
      if (!rect) return;
      const edge = 8;
      const gap = 7;
      const below = window.innerHeight - rect.bottom;
      const above = rect.top;
      const openAbove = below < 220 && above > below;
      const available = Math.max(120, (openAbove ? above : below) - gap - edge);
      const maxWidth = Math.min(window.innerWidth - edge * 2, root.current?.closest("aside") ? rect.width : Infinity);
      const width = Math.min(Math.max(rect.width, contentWidth.menu, 170), maxWidth);
      const left = Math.min(Math.max(rect.left, edge), window.innerWidth - width - edge);
      setListStyle({
        left,
        width,
        maxWidth: width,
        maxHeight: Math.min(280, available),
        ...(openAbove
          ? { top: "auto", bottom: window.innerHeight - rect.top + gap }
          : { top: rect.bottom + gap, bottom: "auto" }),
      });
    };
    place();
    window.addEventListener("resize", place);
    document.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      document.removeEventListener("scroll", place, true);
    };
  }, [open, contentWidth.menu]);

  const activeId = useMemo(() => `${listId}-option-${activeIndex}`, [activeIndex, listId]);
  const listMaxHeight = listStyle.maxHeight;

  useEffect(() => {
    if (!open) return;
    const menu = list.current;
    const active = document.getElementById(activeId);
    if (!menu || !active) return;
    // Scroll only this fixed list, not the document behind it.
    const menuRect = menu.getBoundingClientRect();
    const activeRect = active.getBoundingClientRect();
    const top = menuRect.top + menu.clientTop;
    const bottom = top + menu.clientHeight;
    if (activeRect.top < top) menu.scrollTop += activeRect.top - top;
    else if (activeRect.bottom > bottom) menu.scrollTop += activeRect.bottom - bottom;
  }, [open, activeId, listMaxHeight]);

  const choose = (index: number) => {
    const option = options[index];
    if (!option) return;
    onChange(option.value);
    setOpen(false);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "Tab" && open) {
      setOpen(false);
      return;
    }
    if (event.key === "Escape") {
      setOpen(false);
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (open) choose(activeIndex);
      else setOpen(true);
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (options.length === 0) return;
      if (!open) {
        setOpen(true);
        return;
      }
      const direction = event.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((current) => (current + direction + options.length) % options.length);
      return;
    }
    if (event.key === "Home" && open) {
      event.preventDefault();
      setActiveIndex(0);
    }
    if (event.key === "End" && open) {
      event.preventDefault();
      setActiveIndex(Math.max(options.length - 1, 0));
    }
  };

  return (
    <div
      ref={root}
      className={`select-menu ${open ? "is-open" : ""} ${className}`.trim()}
      style={contentWidth.trigger ? { "--select-menu-natural-width": `${contentWidth.trigger}px` } as CSSProperties : undefined}
    >
      <span ref={sizer} className="select-menu-sizer" aria-hidden="true">
        <span>{placeholder}</span>
        {options.map((option) => (
          <Fragment key={option.value}>
            <span>
              {option.icon && <span className="select-menu-option-icon">{option.icon}</span>}
              <span>{option.label}</span>
            </span>
            {option.group && <span className="select-menu-group">{option.group}</span>}
          </Fragment>
        ))}
      </span>
      <button
        ref={trigger}
        id={id}
        type="button"
        className="select-menu-trigger"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open ? activeId : undefined}
        aria-required={required || undefined}
        title={title}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={onKeyDown}
      >
        <span className={`select-menu-value ${selected ? "" : "select-menu-placeholder"}`.trim()}>
          {selected?.icon && <span className="select-menu-option-icon">{selected.icon}</span>}
          <span>{selected?.label ?? placeholder}</span>
        </span>
        <Icon name="chevronDown" size={16} />
      </button>

      {open && options.length > 0 && typeof document !== "undefined" && createPortal(
        <div ref={list} id={listId} className="select-menu-list" role="listbox" aria-label={label} style={listStyle}>
          {options.map((option, index) => {
            const isSelected = option.value === value;
            return (
              <Fragment key={option.value}>
                {option.group && option.group !== options[index - 1]?.group && (
                  <div className="select-menu-group" role="presentation">{option.group}</div>
                )}
                <div
                  id={`${listId}-option-${index}`}
                  className={`select-menu-option ${isSelected ? "is-selected" : ""} ${activeIndex === index ? "is-active" : ""}`.trim()}
                  role="option"
                  aria-selected={isSelected}
                  onMouseEnter={() => setActiveIndex(index)}
                  onPointerDown={(event) => {
                    // Keep mouse focus on the trigger; touch must remain free to scroll.
                    if (event.pointerType === "mouse") event.preventDefault();
                  }}
                  onClick={() => choose(index)}
                >
                  <span className="select-menu-option-content">
                    {option.icon && <span className="select-menu-option-icon">{option.icon}</span>}
                    <span>{option.label}</span>
                  </span>
                  {isSelected && <Icon name="check" size={15} />}
                </div>
              </Fragment>
            );
          })}
        </div>,
        document.body,
      )}
    </div>
  );
}
