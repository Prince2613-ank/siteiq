import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';

export interface SiteFilterOption { value: string; label: string; count?: number; color?: string; detail?: string }

export function SiteFilterDropdown({ label, options, selected, onChange, allLabel = 'All', sideContent, summaryText, selectionCount }: {
  label: string; options: SiteFilterOption[]; selected: string[];
  onChange: (values: string[]) => void; allLabel?: string;
  sideContent?: ReactNode; summaryText?: string; selectionCount?: number;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  const summary = summaryText ?? (selected.length === 0 ? allLabel : selected.length === 1
    ? options.find(option => option.value === selected[0])?.label ?? '1 selected' : `${selected.length} selected`);
  const visibleName = selected.length === 0 ? allLabel : options.some(option => option.color) && selected.length === 1
    ? options.find(option => option.value === selected[0])?.label ?? label : label;
  return <div className="site-filter-field site-filter-multi" ref={root} onKeyDown={event => {
    if (event.key === 'Escape') { setOpen(false); trigger.current?.focus(); }
  }} onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
  }}>
    <span className="site-filter-label">{label}</span>
    <button ref={trigger} type="button" className="site-filter-select" aria-label={`${label}: ${summary}`}
      data-active={selected.length > 0}
      data-zoning={options.some(option => option.color)}
      style={selected.length === 1 && options.find(option => option.value === selected[0])?.color
        ? { '--zoning-color': options.find(option => option.value === selected[0])?.color } as CSSProperties : undefined}
      aria-expanded={open} onClick={() => setOpen(current => !current)}>
      <span className="site-filter-trigger-name">{visibleName}</span>
      {selected.length > 0 && <span className="site-filter-trigger-count" aria-hidden="true">
        {selectionCount ?? selected.length}<span className="site-filter-count-label"> selected</span>
      </span>}
    </button>
    {open && <div className={`site-filter-options${sideContent ? ' site-filter-options--split' : ''}`} role="group" aria-label={label}>
      <div className="site-filter-primary-options">
      <button type="button" className="site-filter-clear" aria-pressed={selected.length === 0} onClick={() => onChange([])}>{allLabel}</button>
      {options.map(option => <button key={option.value} type="button" className={`site-filter-choice${option.color ? ' site-filter-choice--zoning' : ''}`}
        style={option.color ? { '--zoning-color': option.color } as CSSProperties : undefined}
        aria-pressed={selected.includes(option.value)} onClick={() => onChange(
          selected.includes(option.value) ? selected.filter(value => value !== option.value) : [...selected, option.value])}>
        {option.color && <span className="site-filter-color" style={{ backgroundColor: option.color }} aria-hidden="true" />}
        <span>{option.label}{option.count !== undefined ? ` (${option.count})` : ''}
          {option.detail && <span className="site-filter-selection-count">{option.detail}</span>}
        </span>
      </button>)}
      </div>
      {sideContent && <div className="site-filter-side-options">{sideContent}</div>}
    </div>}
  </div>;
}
