// ============================================================================
// PolyglotQuest — Backend API
// ============================================================================

require('dotenv').config();

const express    = require('express');
const cors       = require('cors');
const bcrypt     = require('bcryptjs');
const jwt        = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const multer     = require('multer');
const fs         = require('fs').promises;

const app        = express();
const PORT       = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'ganti-secret-ini';
const ADMIN_URL  = 'https://polyglotquest.netlify.app/admin.html';
const GAME_URL   = 'https://polyglotquest.netlify.app/game.html';

// ── CORS ─────────────────────────────────────────────────────────────────────
app.use(cors({ origin: '*', methods: ['GET','POST','PUT','DELETE','OPTIONS'], allowedHeaders: ['Content-Type','Authorization'] }));
app.options('*', cors());
app.use(express.json());
app.use('/uploads', express.static('uploads'));

// ── FILE UPLOAD ───────────────────────────────────────────────────────────────
const storage = multer.diskStorage({
    destination: './uploads/',
    filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage });

// ── EMAIL ─────────────────────────────────────────────────────────────────────
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
});

// ── DATABASE (File JSON) ──────────────────────────────────────────────────────
const DB_DIR       = './database';
const USERS_FILE   = `${DB_DIR}/users.json`;
const PAYMENTS_FILE= `${DB_DIR}/payments.json`;
const PROGRESS_FILE= `${DB_DIR}/progress.json`;
const RESETS_FILE  = `${DB_DIR}/resets.json`;

async function initDB() {
    await fs.mkdir(DB_DIR, { recursive: true });
    await fs.mkdir('./uploads', { recursive: true });
    for (const [file, def] of [[USERS_FILE,'[]'],[PAYMENTS_FILE,'[]'],[PROGRESS_FILE,'{}'],[RESETS_FILE,'[]']]) {
        try { await fs.access(file); } catch { await fs.writeFile(file, def); }
    }
    console.log('✓ Database siap');
}

async function readDB(file) {
    try { return JSON.parse(await fs.readFile(file, 'utf8')); }
    catch { return file === PROGRESS_FILE ? {} : []; }
}
async function writeDB(file, data) {
    await fs.writeFile(file, JSON.stringify(data, null, 2));
}

// ── AUTH MIDDLEWARE ───────────────────────────────────────────────────────────
function auth(req, res, next) {
    const token = (req.headers['authorization'] || '').split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Token diperlukan' });
    jwt.verify(token, JWT_SECRET, (err, decoded) => {
        if (err) return res.status(403).json({ error: 'Token tidak valid' });
        req.userId = decoded.userId;
        next();
    });
}

// ── HELPER EMAIL ──────────────────────────────────────────────────────────────
async function sendMail(to, subject, html) {
    try {
        await transporter.sendMail({ from: `"PolyglotQuest" <${process.env.EMAIL_USER}>`, to, subject, html });
        console.log('✓ Email terkirim ke', to);
    } catch(e) { console.error('Email gagal:', e.message); }
}

// ============================================================================
// AUTH ENDPOINTS
// ============================================================================

// REGISTER
app.post('/api/auth/register', async (req, res) => {
    try {
        const { name, email, password, phone } = req.body;
        if (!name || !email || !password || !phone)
            return res.status(400).json({ error: 'Semua field wajib diisi' });
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
            return res.status(400).json({ error: 'Format email tidak valid' });
        if (password.length < 8)
            return res.status(400).json({ error: 'Password minimal 8 karakter' });

        const phoneDigits = phone.replace(/[\s\-\+]/g, '');
        if (!/^\d{10,15}$/.test(phoneDigits))
            return res.status(400).json({ error: 'Format no. ponsel tidak valid' });

        const users = await readDB(USERS_FILE);
        if (users.find(u => u.email === email))
            return res.status(400).json({ error: 'Email sudah terdaftar' });
        if (users.find(u => u.phone === phone))
            return res.status(400).json({ error: 'No. ponsel sudah terdaftar' });

        const newUser = {
            id: Date.now().toString(),
            name, email, phone,
            password: await bcrypt.hash(password, 10),
            freeTrials: 5,
            points: 0,
            createdAt: new Date().toISOString(),
            verified: true
        };
        users.push(newUser);
        await writeDB(USERS_FILE, users);

        // Notif admin
        const waLink = `https://wa.me/${phoneDigits}`;
        await sendMail(
            process.env.ADMIN_EMAIL,
            '🎉 User Baru - PolyglotQuest',
            `<div style="font-family:Arial,sans-serif;max-width:500px;padding:20px;background:#fff;border-radius:12px;">
              <h2 style="color:#6366f1;">👤 User Baru Terdaftar</h2>
              <p><b>Nama:</b> ${name}</p>
              <p><b>Email:</b> ${email}</p>
              <p><b>No. HP:</b> ${phone}</p>
              <p><b>Waktu:</b> ${new Date().toLocaleString('id-ID')}</p>
              <a href="${waLink}" style="display:inline-block;margin-top:12px;background:#25D366;color:#fff;padding:10px 22px;border-radius:8px;text-decoration:none;font-weight:bold;">💬 WhatsApp</a>
            </div>`
        );

        res.json({ message: 'Registrasi berhasil', user: { id: newUser.id, name, email, phone } });
    } catch(e) {
        console.error(e);
        res.status(500).json({ error: 'Terjadi kesalahan server' });
    }
});

// LOGIN
app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const users = await readDB(USERS_FILE);
        const user = users.find(u => u.email === email);
        if (!user) return res.status(401).json({ error: 'Email tidak terdaftar' });
        if (!await bcrypt.compare(password, user.password))
            return res.status(401).json({ error: 'Password salah' });

        const token = jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, { expiresIn: '30d' });
        res.json({ token, user: { id: user.id, name: user.name, email: user.email, freeTrials: user.freeTrials, points: user.points } });
    } catch(e) {
        res.status(500).json({ error: 'Terjadi kesalahan server' });
    }
});

// GET PROFIL
app.get('/api/auth/me', auth, async (req, res) => {
    try {
        const users = await readDB(USERS_FILE);
        const user = users.find(u => u.id === req.userId);
        if (!user) return res.status(404).json({ error: 'User tidak ditemukan' });
        res.json({ id: user.id, name: user.name, email: user.email, freeTrials: user.freeTrials, points: user.points });
    } catch(e) {
        res.status(500).json({ error: 'Terjadi kesalahan server' });
    }
});

// REQUEST RESET PASSWORD (user kirim email, notif ke admin)
app.post('/api/auth/reset-request', async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) return res.status(400).json({ error: 'Email harus diisi' });

        const users = await readDB(USERS_FILE);
        const user  = users.find(u => u.email === email);

        // Selalu balas sukses agar tidak bocorkan info email terdaftar atau tidak
        if (user) {
            const resets = await readDB(RESETS_FILE);
            resets.push({ id: Date.now().toString(), userId: user.id, userName: user.name, userEmail: user.email, userPhone: user.phone || '-', requestedAt: new Date().toISOString(), status: 'pending' });
            await writeDB(RESETS_FILE, resets);

            await sendMail(
                process.env.ADMIN_EMAIL,
                '🔑 Permintaan Reset Password - PolyglotQuest',
                `<div style="font-family:Arial,sans-serif;max-width:500px;padding:20px;">
                  <h2 style="color:#f59e0b;">🔑 Reset Password Diminta</h2>
                  <p><b>Nama:</b> ${user.name}</p>
                  <p><b>Email:</b> ${user.email}</p>
                  <p><b>No. HP:</b> ${user.phone || '-'}</p>
                  <p><b>Waktu:</b> ${new Date().toLocaleString('id-ID')}</p>
                  <a href="${ADMIN_URL}" style="display:inline-block;margin-top:12px;background:#6366f1;color:#fff;padding:10px 22px;border-radius:8px;text-decoration:none;font-weight:bold;">Buka Admin Panel</a>
                </div>`
            );
        }

        res.json({ message: 'Jika email terdaftar, permintaan telah dikirim ke admin. Admin akan menghubungi kamu dalam 1x24 jam.' });
    } catch(e) {
        res.status(500).json({ error: 'Terjadi kesalahan server' });
    }
});

// ============================================================================
// PROGRESS
// ============================================================================

app.get('/api/progress', auth, async (req, res) => {
    try {
        const progress = await readDB(PROGRESS_FILE);
        res.json(progress[req.userId] || {});
    } catch(e) { res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/progress', auth, async (req, res) => {
    try {
        const { languageId, difficultyId, level, score } = req.body;
        const progress = await readDB(PROGRESS_FILE);
        if (!progress[req.userId]) progress[req.userId] = {};
        const key = `${languageId}_${difficultyId}`;
        if (!progress[req.userId][key]) progress[req.userId][key] = { level: 0, score: 0 };
        progress[req.userId][key].level = Math.max(progress[req.userId][key].level, level);
        progress[req.userId][key].score += score;
        await writeDB(PROGRESS_FILE, progress);

        const users = await readDB(USERS_FILE);
        const idx = users.findIndex(u => u.id === req.userId);
        if (idx !== -1) {
            if (users[idx].freeTrials > 0) users[idx].freeTrials--;
            else if (users[idx].points > 0) users[idx].points--;
            else return res.status(403).json({ error: 'Trial dan poin habis' });
            await writeDB(USERS_FILE, users);
        }
        res.json({ message: 'Progress tersimpan', progress: progress[req.userId] });
    } catch(e) { res.status(500).json({ error: 'Server error' }); }
});

// ============================================================================
// PAYMENT
// ============================================================================

app.post('/api/payment/submit', auth, upload.single('proof'), async (req, res) => {
    try {
        const { packageType, points, amount, method } = req.body;
        if (!req.file) return res.status(400).json({ error: 'Bukti transfer wajib diupload' });

        const validPkgs = {
            single: { points: 300, price: 15000, name: 'Single Language (300 pts)' },
            full:   { points: 2100, price: 49000, name: 'Full Access 7-in-1 (2,100 pts)' }
        };
        const pkg = validPkgs[packageType];
        if (!pkg || pkg.points !== parseInt(points) || pkg.price !== parseInt(amount))
            return res.status(400).json({ error: 'Paket tidak valid' });

        const users = await readDB(USERS_FILE);
        const user  = users.find(u => u.id === req.userId);
        if (!user) return res.status(404).json({ error: 'User tidak ditemukan' });

        const payment = {
            id: Date.now().toString(),
            userId: req.userId, userName: user.name, userEmail: user.email,
            packageType, packageName: pkg.name,
            points: parseInt(points), amount: parseInt(amount), method,
            proofImage: `/uploads/${req.file.filename}`,
            status: 'pending', createdAt: new Date().toISOString()
        };
        const payments = await readDB(PAYMENTS_FILE);
        payments.push(payment);
        await writeDB(PAYMENTS_FILE, payments);

        await sendMail(process.env.ADMIN_EMAIL, '💳 Pembayaran Baru - PolyglotQuest',
            `<div style="font-family:Arial;padding:20px;"><h2 style="color:#f59e0b;">💳 Pembayaran Baru</h2>
            <p><b>User:</b> ${user.name} (${user.email})</p>
            <p><b>Paket:</b> ${pkg.name}</p>
            <p><b>Total:</b> Rp ${parseInt(amount).toLocaleString('id-ID')}</p>
            <p><b>Metode:</b> ${method}</p>
            <a href="${ADMIN_URL}" style="display:inline-block;background:#6366f1;color:#fff;padding:10px 22px;border-radius:8px;text-decoration:none;margin-top:12px;">Buka Admin Panel</a></div>`
        );
        await sendMail(user.email, '✅ Pembayaran Diterima - PolyglotQuest',
            `<div style="font-family:Arial;padding:20px;"><h2 style="color:#10b981;">✅ Pembayaran Diterima</h2>
            <p>Halo <b>${user.name}</b>, pembayaran kamu sedang diverifikasi.</p>
            <p><b>Paket:</b> ${pkg.name} | <b>Total:</b> Rp ${parseInt(amount).toLocaleString('id-ID')}</p>
            <p>Points akan masuk otomatis setelah admin menyetujui (maks 1x24 jam).</p></div>`
        );

        res.json({ success: true, message: 'Pembayaran disubmit, menunggu verifikasi admin.', payment });
    } catch(e) {
        console.error(e);
        res.status(500).json({ error: 'Server error' });
    }
});

app.get('/api/payments/user', auth, async (req, res) => {
    try {
        const payments = await readDB(PAYMENTS_FILE);
        res.json(payments.filter(p => p.userId === req.userId));
    } catch(e) { res.status(500).json({ error: 'Server error' }); }
});

// ============================================================================
// ADMIN — PAYMENTS
// ============================================================================

app.get('/api/admin/payments/all', async (req, res) => {
    try {
        const payments = await readDB(PAYMENTS_FILE);
        payments.sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt));
        res.json(payments);
    } catch(e) { res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/admin/payments/:id/approve', async (req, res) => {
    try {
        const payments = await readDB(PAYMENTS_FILE);
        const idx = payments.findIndex(p => p.id === req.params.id);
        if (idx === -1) return res.status(404).json({ error: 'Tidak ditemukan' });
        if (payments[idx].status !== 'pending') return res.status(400).json({ error: 'Sudah diproses' });

        payments[idx].status    = 'approved';
        payments[idx].approvedAt= new Date().toISOString();
        await writeDB(PAYMENTS_FILE, payments);

        const users = await readDB(USERS_FILE);
        const uIdx  = users.findIndex(u => u.id === payments[idx].userId);
        if (uIdx !== -1) { users[uIdx].points += payments[idx].points; await writeDB(USERS_FILE, users); }

        await sendMail(payments[idx].userEmail, '🎉 Pembayaran Disetujui - PolyglotQuest',
            `<div style="font-family:Arial;padding:20px;"><h2 style="color:#10b981;">🎉 Pembayaran Disetujui!</h2>
            <p><b>+${payments[idx].points} Points</b> sudah masuk ke akun kamu!</p>
            <a href="${GAME_URL}" style="display:inline-block;background:#6366f1;color:#fff;padding:10px 22px;border-radius:8px;text-decoration:none;margin-top:12px;">Mulai Belajar</a></div>`
        );
        res.json({ message: 'Diapprove', payment: payments[idx] });
    } catch(e) { res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/admin/payments/:id/reject', async (req, res) => {
    try {
        const { reason } = req.body;
        const payments = await readDB(PAYMENTS_FILE);
        const idx = payments.findIndex(p => p.id === req.params.id);
        if (idx === -1) return res.status(404).json({ error: 'Tidak ditemukan' });

        payments[idx].status    = 'rejected';
        payments[idx].rejectedAt= new Date().toISOString();
        payments[idx].rejectReason = reason || 'Bukti tidak valid';
        await writeDB(PAYMENTS_FILE, payments);

        await sendMail(payments[idx].userEmail, '❌ Pembayaran Ditolak - PolyglotQuest',
            `<div style="font-family:Arial;padding:20px;"><h2 style="color:#ef4444;">❌ Pembayaran Ditolak</h2>
            <p><b>Alasan:</b> ${payments[idx].rejectReason}</p>
            <p>Silakan coba lagi dengan bukti yang valid.</p></div>`
        );
        res.json({ message: 'Ditolak', payment: payments[idx] });
    } catch(e) { res.status(500).json({ error: 'Server error' }); }
});

// ============================================================================
// ADMIN — USERS
// ============================================================================

// Lihat semua user (termasuk hash password)
app.get('/api/admin/users', async (req, res) => {
    try {
        const users = await readDB(USERS_FILE);
        const result = users
            .map(u => ({ id: u.id, name: u.name, email: u.email, phone: u.phone || '-', password: u.password, freeTrials: u.freeTrials, points: u.points, createdAt: u.createdAt }))
            .sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt));
        res.json(result);
    } catch(e) { res.status(500).json({ error: 'Server error' }); }
});

// Ganti password user (oleh admin)
app.post('/api/admin/users/:userId/password', async (req, res) => {
    try {
        const { newPassword } = req.body;
        if (!newPassword || newPassword.length < 8)
            return res.status(400).json({ error: 'Password minimal 8 karakter' });

        const users = await readDB(USERS_FILE);
        const idx   = users.findIndex(u => u.id === req.params.userId);
        if (idx === -1) return res.status(404).json({ error: 'User tidak ditemukan' });

        users[idx].password = await bcrypt.hash(newPassword, 10);
        await writeDB(USERS_FILE, users);

        await sendMail(users[idx].email, '🔑 Password Akun Direset - PolyglotQuest',
            `<div style="font-family:Arial;padding:20px;"><h2 style="color:#6366f1;">🔑 Password Berhasil Direset</h2>
            <p>Halo <b>${users[idx].name}</b>, password akun kamu telah diganti oleh admin.</p>
            <p><b>Password Baru:</b> <code style="background:#f3f4f6;padding:2px 8px;border-radius:4px;">${newPassword}</code></p>
            <p>Segera login dan ganti ke password yang kamu inginkan.</p>
            <a href="${GAME_URL}" style="display:inline-block;background:#6366f1;color:#fff;padding:10px 22px;border-radius:8px;text-decoration:none;margin-top:12px;">Login Sekarang</a></div>`
        );
        res.json({ message: 'Password berhasil diganti' });
    } catch(e) { res.status(500).json({ error: 'Server error' }); }
});

// Tambah 1 trial ke user
app.post('/api/admin/users/:userId/add-trial', async (req, res) => {
    try {
        const users = await readDB(USERS_FILE);
        const idx   = users.findIndex(u => u.id === req.params.userId);
        if (idx === -1) return res.status(404).json({ error: 'User tidak ditemukan' });
        users[idx].freeTrials = (users[idx].freeTrials || 0) + 1;
        await writeDB(USERS_FILE, users);
        res.json({ message: 'Trial ditambahkan', freeTrials: users[idx].freeTrials });
    } catch(e) { res.status(500).json({ error: 'Server error' }); }
});

// Lihat permintaan reset password
app.get('/api/admin/reset-requests', async (req, res) => {
    try {
        const resets = await readDB(RESETS_FILE);
        resets.sort((a,b) => new Date(b.requestedAt) - new Date(a.requestedAt));
        res.json(resets);
    } catch(e) { res.status(500).json({ error: 'Server error' }); }
});

// ============================================================================
// START
// ============================================================================

initDB().then(() => {
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`
╔══════════════════════════════════════╗
║   PolyglotQuest Backend  PORT:${PORT}  ║
╚══════════════════════════════════════╝
AUTH    POST /api/auth/register
        POST /api/auth/login
        GET  /api/auth/me
        POST /api/auth/reset-request
GAME    GET  /api/progress
        POST /api/progress
        POST /api/payment/submit
        GET  /api/payments/user
ADMIN   GET  /api/admin/users
        POST /api/admin/users/:id/password
        POST /api/admin/users/:id/add-trial
        GET  /api/admin/payments/all
        POST /api/admin/payments/:id/approve
        POST /api/admin/payments/:id/reject
        GET  /api/admin/reset-requests
        `);
    });
});
