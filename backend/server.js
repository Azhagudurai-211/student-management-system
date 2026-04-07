
const express = require('express');
const path = require('path');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 10000;
const DATABASE_URL = process.env.DATABASE_URL;
const NETLIFY_URL = process.env.NETLIFY_URL || '';
const EXTRA_CORS_ORIGINS = (process.env.CORS_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);

if (!DATABASE_URL) {
  console.error('Missing DATABASE_URL environment variable');
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

app.use(cors({
  origin(origin, callback) {
    const allowed = [NETLIFY_URL, ...EXTRA_CORS_ORIGINS, 'http://localhost:3000', 'http://localhost:10000', 'http://127.0.0.1:3000', 'http://127.0.0.1:10000'].filter(Boolean);
    if (!origin || allowed.includes(origin)) return callback(null, true);
    return callback(new Error('CORS blocked for origin: ' + origin));
  }
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }
});

async function query(text, params = []) {
  return pool.query(text, params);
}
async function getOne(text, params = []) {
  const { rows } = await pool.query(text, params);
  return rows[0] || null;
}
async function getAll(text, params = []) {
  const { rows } = await pool.query(text, params);
  return rows;
}

async function initDb() {
  await query(`CREATE TABLE IF NOT EXISTS admins (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`);

  await query(`CREATE TABLE IF NOT EXISTS students (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    roll TEXT NOT NULL UNIQUE,
    department TEXT NOT NULL,
    "studentClass" TEXT NOT NULL,
    marks NUMERIC DEFAULT 0,
    result TEXT DEFAULT 'Fail',
    attendance TEXT DEFAULT 'Present',
    "totalFees" NUMERIC DEFAULT 0,
    "paidFees" NUMERIC DEFAULT 0,
    "feeStatus" TEXT DEFAULT 'Unpaid',
    phone TEXT DEFAULT '',
    email TEXT DEFAULT '',
    address TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    photo TEXT DEFAULT '',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`);
}

function resultFromMarks(marks) {
  return Number(marks) >= 40 ? 'Pass' : 'Fail';
}
function feeStatus(totalFees, paidFees) {
  totalFees = Number(totalFees) || 0;
  paidFees = Number(paidFees) || 0;
  if (totalFees === 0 || paidFees >= totalFees) return 'Paid';
  if (paidFees > 0) return 'Partial';
  return 'Unpaid';
}
function normalizeStudent(body) {
  const marks = Number(body.marks) || 0;
  const totalFees = Number(body.totalFees) || 0;
  const paidFees = Number(body.paidFees) || 0;
  return {
    name: String(body.name || '').trim(),
    roll: String(body.roll || '').trim(),
    department: String(body.department || '').trim(),
    studentClass: String(body.studentClass || '').trim(),
    marks,
    result: resultFromMarks(marks),
    attendance: String(body.attendance || 'Present').toLowerCase() === 'absent' ? 'Absent' : 'Present',
    totalFees,
    paidFees,
    feeStatus: feeStatus(totalFees, paidFees),
    phone: String(body.phone || '').trim(),
    email: String(body.email || '').trim(),
    address: String(body.address || '').trim(),
    notes: String(body.notes || '').trim(),
    photo: String(body.photo || '').trim()
  };
}
function fileToDataUrl(file) {
  if (!file) return '';
  return `data:${file.mimetype};base64,${file.buffer.toString('base64')}`;
}
function cleanDbStudent(row) {
  if (!row) return row;
  return {
    ...row,
    marks: Number(row.marks) || 0,
    totalFees: Number(row.totalFees) || 0,
    paidFees: Number(row.paidFees) || 0,
  };
}

app.get('/api/health', async (req, res) => {
  try {
    await query('SELECT 1');
    res.json({ ok: true, database: 'connected' });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/admin/signup', async (req, res) => {
  try {
    const name = String(req.body.name || '').trim();
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '').trim();
    if (!name || !email || !password) return res.status(400).json({ error: 'Fill all admin fields' });
    const exists = await getOne('SELECT id FROM admins WHERE email = $1', [email]);
    if (exists) return res.status(400).json({ error: 'Admin email already exists' });
    const hash = await bcrypt.hash(password, 10);
    await query('INSERT INTO admins (name, email, password_hash) VALUES ($1, $2, $3)', [name, email, hash]);
    res.json({ message: 'Admin account created successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/login', async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '').trim();
    const admin = await getOne('SELECT id, name, email, password_hash FROM admins WHERE email = $1', [email]);
    if (!admin) return res.status(401).json({ error: 'Admin account not found' });
    const ok = await bcrypt.compare(password, admin.password_hash);
    if (!ok) return res.status(401).json({ error: 'Wrong password' });
    res.json({ user: { id: admin.id, name: admin.name, email: admin.email } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/students', async (req, res) => {
  try {
    const rows = await getAll('SELECT id, name, roll, department, "studentClass", marks, result, attendance, "totalFees", "paidFees", "feeStatus", phone, email, address, notes, photo, created_at, updated_at FROM students ORDER BY id DESC');
    res.json(rows.map(cleanDbStudent));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/students', upload.single('photoFile'), async (req, res) => {
  try {
    const student = normalizeStudent(req.body);
    if (!student.name || !student.roll || !student.department || !student.studentClass) {
      return res.status(400).json({ error: 'Missing required student fields' });
    }
    if (req.file) student.photo = fileToDataUrl(req.file);
    const created = await getOne(`INSERT INTO students
      (name, roll, department, "studentClass", marks, result, attendance, "totalFees", "paidFees", "feeStatus", phone, email, address, notes, photo, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, CURRENT_TIMESTAMP)
      RETURNING id, name, roll, department, "studentClass", marks, result, attendance, "totalFees", "paidFees", "feeStatus", phone, email, address, notes, photo, created_at, updated_at`,
      [student.name, student.roll, student.department, student.studentClass, student.marks, student.result, student.attendance, student.totalFees, student.paidFees, student.feeStatus, student.phone, student.email, student.address, student.notes, student.photo]
    );
    res.json(cleanDbStudent(created));
  } catch (err) {
    if (String(err.message).toLowerCase().includes('duplicate key')) return res.status(400).json({ error: 'Roll number already exists' });
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/students/:id', upload.single('photoFile'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const existing = await getOne('SELECT * FROM students WHERE id = $1', [id]);
    if (!existing) return res.status(404).json({ error: 'Student not found' });
    const student = normalizeStudent({ ...existing, ...req.body, photo: existing.photo });
    if (req.file) student.photo = fileToDataUrl(req.file);
    const updated = await getOne(`UPDATE students SET
      name=$1, roll=$2, department=$3, "studentClass"=$4, marks=$5, result=$6, attendance=$7, "totalFees"=$8, "paidFees"=$9, "feeStatus"=$10, phone=$11, email=$12, address=$13, notes=$14, photo=$15, updated_at=CURRENT_TIMESTAMP
      WHERE id=$16
      RETURNING id, name, roll, department, "studentClass", marks, result, attendance, "totalFees", "paidFees", "feeStatus", phone, email, address, notes, photo, created_at, updated_at`,
      [student.name, student.roll, student.department, student.studentClass, student.marks, student.result, student.attendance, student.totalFees, student.paidFees, student.feeStatus, student.phone, student.email, student.address, student.notes, student.photo, id]
    );
    res.json(cleanDbStudent(updated));
  } catch (err) {
    if (String(err.message).toLowerCase().includes('duplicate key')) return res.status(400).json({ error: 'Roll number already exists' });
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/students/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const existing = await getOne('SELECT id FROM students WHERE id = $1', [id]);
    if (!existing) return res.status(404).json({ error: 'Student not found' });
    await query('DELETE FROM students WHERE id = $1', [id]);
    res.json({ message: 'Student deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/students/bulk', async (req, res) => {
  try {
    const rows = Array.isArray(req.body.students) ? req.body.students : [];
    if (!rows.length) return res.status(400).json({ error: 'No students to import' });
    let added = 0, skipped = 0;
    for (const row of rows) {
      const student = normalizeStudent(row);
      if (!student.name || !student.roll || !student.department || !student.studentClass) { skipped++; continue; }
      try {
        await query(`INSERT INTO students
          (name, roll, department, "studentClass", marks, result, attendance, "totalFees", "paidFees", "feeStatus", phone, email, address, notes, photo, updated_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, CURRENT_TIMESTAMP)`,
          [student.name, student.roll, student.department, student.studentClass, student.marks, student.result, student.attendance, student.totalFees, student.paidFees, student.feeStatus, student.phone, student.email, student.address, student.notes, student.photo]
        );
        added++;
      } catch (err) {
        skipped++;
      }
    }
    res.json({ message: `Import completed. Added: ${added}, Skipped: ${skipped}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/dashboard/summary', async (req, res) => {
  try {
    const students = (await getAll('SELECT marks, attendance, "totalFees", "paidFees", result FROM students')).map(cleanDbStudent);
    const total = students.length;
    const avgMarks = total ? (students.reduce((sum, s) => sum + Number(s.marks || 0), 0) / total).toFixed(1) : '0.0';
    const present = students.filter(s => s.attendance === 'Present').length;
    const attendanceRate = total ? ((present / total) * 100).toFixed(0) : '0';
    const paidFees = students.reduce((sum, s) => sum + Number(s.paidFees || 0), 0);
    const totalFees = students.reduce((sum, s) => sum + Number(s.totalFees || 0), 0);
    const pendingFees = Math.max(totalFees - paidFees, 0);
    const passRate = total ? ((students.filter(s => s.result === 'Pass').length / total) * 100).toFixed(0) : '0';
    res.json({ total, avgMarks, attendanceRate, paidFees, pendingFees, passRate });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.use(express.static(path.join(__dirname, '../frontend')));
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

initDb()
  .then(() => app.listen(PORT, () => console.log(`Server running on port ${PORT}`)))
  .catch(err => {
    console.error('Database init failed:', err);
    process.exit(1);
  });
