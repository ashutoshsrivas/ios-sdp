import { useState, useEffect, useRef } from 'react';
import { api } from '../lib/api';

// Type a name / email / student id / phone → suggestions from the roster.
// Picking one calls onPick(rosterRow) so the parent can auto-fill its form.
export default function RosterSearch({ onPick, placeholder = 'Search by name, email, student id or phone…' }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(-1);
  const boxRef = useRef(null);

  useEffect(() => {
    if (q.trim().length < 2) { setResults([]); setOpen(false); return; }
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const rows = await api.get(`/api/roster/search?q=${encodeURIComponent(q.trim())}`);
        setResults(rows);
        setOpen(true);
        setActive(-1);
      } catch { /* ignore */ } finally { setLoading(false); }
    }, 220);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    const onClick = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const pick = (row) => {
    onPick(row);
    setQ('');
    setResults([]);
    setOpen(false);
  };

  const onKey = (e) => {
    if (!open || !results.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, results.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); pick(results[active]); }
    else if (e.key === 'Escape') setOpen(false);
  };

  return (
    <div className="ac-wrap" ref={boxRef}>
      <div className="ac-input">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
          <circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" />
        </svg>
        <input
          className="input"
          style={{ border: 'none', background: 'transparent', padding: '10px 4px', boxShadow: 'none' }}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => results.length && setOpen(true)}
          onKeyDown={onKey}
          placeholder={placeholder}
        />
        {loading && <div className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} />}
      </div>
      {open && (
        <div className="ac-menu">
          {results.length === 0 ? (
            <div className="ac-empty">No matches in the directory</div>
          ) : (
            results.map((r, i) => (
              <button
                type="button"
                key={r.id}
                className={`ac-item ${i === active ? 'active' : ''}`}
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(r)}
              >
                <div className="ac-name">{r.full_name}</div>
                <div className="ac-meta">
                  {r.student_id ? `#${r.student_id}` : ''}{r.email ? ` · ${r.email}` : ''}
                  {r.campus ? ` · ${r.campus}` : ''}
                </div>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
