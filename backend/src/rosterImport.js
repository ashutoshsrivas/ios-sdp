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

// The columns the importer understands, in a sensible display order. The header labels
// here are what classifyHeader() matches on, so keep them in sync with that function.
const TEMPLATE_COLUMNS = [
  { header: 'Student Id', example: 'GEU2026001', width: 16 },
  { header: 'Full Name', example: 'Jane Doe', width: 24 },
  { header: 'Email ID', example: 'jane.doe@example.com', width: 30 },
  { header: 'Phone', example: '9876543210', width: 16 },
  { header: 'University Campus', example: 'GEU Dehradun', width: 22 },
  { header: 'Test No', example: 'T-01', width: 10 },
  { header: 'Status', example: 'CNF', width: 10 },
];

// Build a blank .xlsx the admin can fill in and re-upload through /api/roster/import.
// One bold, frozen header row + a single greyed-out example row to show the format.
async function buildTemplateBuffer() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Roster');

  ws.columns = TEMPLATE_COLUMNS.map((c) => ({ header: c.header, key: c.header, width: c.width }));

  const header = ws.getRow(1);
  header.font = { bold: true };
  header.getCell(TEMPLATE_COLUMNS.findIndex((c) => c.header === 'Status') + 1).note =
    'Optional. Common values: CNF (confirmed), WL (waitlist).';

  const example = ws.addRow(TEMPLATE_COLUMNS.map((c) => c.example));
  example.font = { italic: true, color: { argb: 'FF9AA0A6' } };

  ws.views = [{ state: 'frozen', ySplit: 1 }];
  return wb.xlsx.writeBuffer();
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

module.exports = { parseRosterBuffer, upsertRoster, buildTemplateBuffer };
