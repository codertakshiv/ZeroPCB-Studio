/**
 * Shared UI primitives
 */

import React from 'react';

export function Panel({ 
  title, 
  children, 
  defaultOpen = true,
  actions,
  className = '',
}: { 
  title: string; 
  children: React.ReactNode; 
  defaultOpen?: boolean;
  actions?: React.ReactNode;
  className?: string;
}) {
  const [open, setOpen] = React.useState(defaultOpen);
  
  return (
    <div className={`border border-app rounded-xl overflow-hidden bg-panel panel-card ${className}`}>
      <button
        className="w-full flex items-center justify-between px-3.5 py-2.5 hover-bg text-left"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        <span className="text-[13px] font-semibold text-app tracking-tight">{title}</span>
        <span className="flex items-center gap-2">
          {actions}
          <span className="text-muted text-xs">{open ? '▾' : '▸'}</span>
        </span>
      </button>
      {open && (
        <div className="px-3.5 py-3 border-t border-app">
          {children}
        </div>
      )}
    </div>
  );
}

export function Button({
  children,
  onClick,
  disabled = false,
  variant = 'default',
  size = 'md',
  title,
  className = '',
  type = 'button',
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: 'default' | 'primary' | 'danger' | 'ghost';
  size?: 'sm' | 'md';
  title?: string;
  className?: string;
  type?: 'button' | 'submit';
}) {
  const base = 'rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-1';
  const sizes = {
    sm: 'px-2.5 py-1.5 text-xs',
    md: 'px-3.5 py-2 text-sm',
  };
  const variants = {
    default: 'border border-app bg-panel text-app hover-bg',
    primary: 'font-semibold',
    danger: 'text-white',
    ghost: 'text-app hover-bg',
  };
  
  const style: React.CSSProperties = {};
  if (variant === 'primary') {
    style.backgroundColor = 'var(--accent)';
    style.color = 'var(--accent-ink)';
    style.boxShadow = '0 0 18px var(--accent-glow)';
  }
  if (variant === 'danger') style.backgroundColor = 'var(--danger)';
  
  return (
    <button
      type={type}
      className={`${base} ${sizes[size]} ${variants[variant]} ${className}`}
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={style}
    >
      {children}
    </button>
  );
}

export function Input({
  value,
  onChange,
  placeholder,
  type = 'text',
  min,
  max,
  step,
  label,
  className = '',
  disabled = false,
  onKeyDown,
}: {
  value: string | number;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
  min?: number;
  max?: number;
  step?: number;
  label?: string;
  className?: string;
  disabled?: boolean;
  onKeyDown?: (e: React.KeyboardEvent) => void;
}) {
  return (
    <label className={`flex flex-col gap-1 ${className}`}>
      {label && <span className="text-xs text-muted">{label}</span>}
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onKeyDown={onKeyDown}
        className="px-2 py-1 text-sm rounded border border-app bg-app text-app w-full"
      />
    </label>
  );
}

export function Select({
  value,
  onChange,
  options,
  label,
  className = '',
  disabled = false,
}: {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  label?: string;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <label className={`flex flex-col gap-1 ${className}`}>
      {label && <span className="text-xs text-muted">{label}</span>}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="px-2 py-1 text-sm rounded border border-app bg-app text-app w-full"
      >
        {options.map(opt => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
    </label>
  );
}

export function Badge({
  children,
  variant = 'default',
}: {
  children: React.ReactNode;
  variant?: 'default' | 'success' | 'warning' | 'error' | 'info';
}) {
  const style: React.CSSProperties = {};
  switch (variant) {
    case 'success': style.backgroundColor = 'var(--success)'; style.color = 'var(--accent-ink)'; break;
    case 'warning': style.backgroundColor = 'var(--warning)'; style.color = 'white'; break;
    case 'error': style.backgroundColor = 'var(--danger)'; style.color = 'white'; break;
    case 'info': style.backgroundColor = 'var(--accent)'; style.color = 'var(--accent-ink)'; break;
    default: style.backgroundColor = 'var(--hover-bg)'; style.color = 'var(--text)';
  }
  
  return (
    <span
      className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium"
      style={style}
    >
      {children}
    </span>
  );
}

export function Tooltip({ content, children }: { content: string; children: React.ReactNode }) {
  return <span title={content}>{children}</span>;
}

export function EmptyState({ message, hint }: { message: string; hint?: string }) {
  return (
    <div className="text-center py-6 px-3">
      <p className="text-sm text-muted">{message}</p>
      {hint && <p className="text-xs text-muted mt-1 opacity-75">{hint}</p>}
    </div>
  );
}