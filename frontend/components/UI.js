import { createContext, useContext, useState, useCallback } from 'react';

/* ---------------- Toasts ---------------- */
const ToastContext = createContext(null);
let idc = 0;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const push = useCallback((message, type = 'default') => {
    const id = ++idc;
    setToasts((t) => [...t, { id, message, type }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3200);
  }, []);
  const toast = {
    show: (m) => push(m, 'default'),
    ok: (m) => push(m, 'ok'),
    err: (m) => push(m, 'err'),
  };
  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div className="toast-wrap">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.type}`}>{t.message}</div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
export const useToast = () => useContext(ToastContext);

/* ---------------- Primitives ---------------- */
export function Button({ variant = '', size = '', block, children, className = '', ...props }) {
  return (
    <button className={`btn ${variant} ${size} ${block ? 'block' : ''} ${className}`} {...props}>
      {children}
    </button>
  );
}

export function Card({ children, className = '', ...props }) {
  return <div className={`card ${className}`} {...props}>{children}</div>;
}

export function Field({ label, children }) {
  return (
    <div className="field">
      {label && <label>{label}</label>}
      {children}
    </div>
  );
}

export function Input(props) {
  return <input className="input" {...props} />;
}
export function Textarea(props) {
  return <textarea className="input" {...props} />;
}
export function Select({ children, ...props }) {
  return <select className="select" {...props}>{children}</select>;
}

export function Badge({ color = 'gray', children }) {
  return <span className={`badge ${color}`}>{children}</span>;
}

const AV_COLORS = ['#007aff', '#34c759', '#ff9500', '#af52de', '#ff2d55', '#5856d6', '#ff6482', '#30b0c7'];
export function Avatar({ name = '?', id = 0 }) {
  const initials = name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  const color = AV_COLORS[(id + name.length) % AV_COLORS.length];
  return <div className="avatar" style={{ background: color }}>{initials || '?'}</div>;
}

export function Segmented({ value, onChange, options }) {
  return (
    <div className="segmented">
      {options.map((o) => (
        <button
          key={o.value}
          className={value === o.value ? 'active' : ''}
          onClick={() => onChange(o.value)}
          type="button"
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Switch({ checked, onChange, label }) {
  return (
    <label className="switch-row">
      <span className="switch">
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span className="switch-track"><span className="switch-knob" /></span>
      </span>
      {label && <span>{label}</span>}
    </label>
  );
}

export function Modal({ title, children, onClose, footer, wide }) {
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" style={wide ? { maxWidth: 720 } : undefined} onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>{title}</h3>
          <Button variant="ghost" size="sm" onClick={onClose}>✕</Button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Empty({ icon = '✨', title, subtitle }) {
  return (
    <div className="empty">
      <div className="big">{icon}</div>
      <div style={{ fontWeight: 600, color: 'var(--text-2)' }}>{title}</div>
      {subtitle && <div style={{ marginTop: 4 }}>{subtitle}</div>}
    </div>
  );
}

export function Loading() {
  return <div className="center-load"><div className="spinner" /></div>;
}
