const ExcelJS = require('exceljs');
const { q } = require('./db');

// Map a spreadsheet header to one of our roster fields (fuzzy, case-insensitive).
function classifyHeader(raw) {
  const h = String(raw || '').toLowerCase().replace(/[^a-z]/g, '');
  if (!h) return null;
  if (h.includes('studentid') || h === 'sid' || h.includes('rollno') || h.includes('rollnumber') || h === 'roll')
    return 'student_id';
  if (h.includes('name')) return 'full_name';
  if (h.includes('email') || h.includes('mail')) return 'email';
  if (h.includes('phone') || h.includes('mobile') || h.includes('contact')) return 'phone';
  if (h.includes('campus') || h.includes('university') || h.includes('college')) return 'campus';
  if (h.includes('test')) return 'test_no';
  if (h.includes('status') || h.includes('stutus')) return 'status';
  return null;
}

function cell(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'object') {
    if (v.text) return String(v.text).trim(); // rich text / hyperlink
    if (v.result !== undefined) return String(v.result).trim(); // formula
    return String(v).trim();
  }
  return String(v).trim();
}

// Parse an .xlsx buffer into normalized roster rows.
async function parseRosterBuffer(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.worksheets[0];
  if (!ws) return [];

  const rows = [];
  let colMap = null;
  ws.eachRow((row, rowNumber) => {
    const values = row.values; // 1-indexed array
    if (!colMap) {
      // First non-empty row is the header.
      colMap = {};
      values.forEach((v, idx) => {
        const field = classifyHeader(v);
        if (field && !(field in colMap)) colMap[field] = idx;
      });
      // If we didn't find at least a name column, this wasn't a header row.
      if (!('full_name' in colMap)) colMap = null;
      return;
    }
    const rec = {};
    for (const [field, idx] of Object.entries(colMap)) rec[field] = cell(values[idx]);
    if (!rec.full_name) return; // skip blank rows
    rows.push(rec);
  });
  return rows;
}

// Upsert rows into the roster. Dedups by student_id when present, else by email.
async function upsertRoster(rows) {
  let inserted = 0;
  let updated = 0;
  let seq = 0; // preserves the row order from the uploaded file
  for (const r of rows) {
    seq += 1;
    const sid = r.student_id || null;
    let existing = [];
    if (sid) existing = await q(`SELECT id FROM roster WHERE student_id = ?`, [sid]);
    else if (r.email) existing = await q(`SELECT id FROM roster WHERE email = ?`, [r.email.toLowerCase()]);

    const fields = [
      sid,
      r.full_name,
      r.email ? r.email.toLowerCase() : null,
      r.phone || null,
      r.campus || null,
      r.test_no || null,
      r.status || null,
      seq,
    ];
    if (existing.length) {
      await q(
        `UPDATE roster SET student_id=?, full_name=?, email=?, phone=?, campus=?, test_no=?, status=?, sort_order=? WHERE id=?`,
        [...fields, existing[0].id]
      );
      updated++;
    } else {
      await q(
        `INSERT INTO roster (student_id, full_name, email, phone, campus, test_no, status, sort_order) VALUES (?,?,?,?,?,?,?,?)`,
        fields
      );
      inserted++;
    }
  }
  return { inserted, updated, total: rows.length };
}

module.exports = { parseRosterBuffer, upsertRoster };
