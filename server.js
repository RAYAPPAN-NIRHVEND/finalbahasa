// ============================================================================
// PolyglotQuest — Backend API v3.0 (Supabase Edition)
// ============================================================================
// SETUP WAJIB:
// 1. Daftar gratis di https://supabase.com → buat project baru
// 2. Buka SQL Editor, jalankan SQL ini:
//
//    CREATE TABLE users (
//      id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL,
//      phone TEXT, password TEXT NOT NULL, free_trials INTEGER DEFAULT 5,
//      points INTEGER DEFAULT 0, created_at TIMESTAMPTZ DEFAULT NOW()
//    );
//    CREATE TABLE payments (
//      id TEXT PRIMARY KEY, user_id TEXT, user_name TEXT, user_email TEXT,
//      package_name TEXT, package_type TEXT, amount INTEGER, points INTEGER,
//      method TEXT, proof_image TEXT, status TEXT DEFAULT 'pending',
//      created_at TIMESTAMPTZ DEFAULT NOW(), approved_at TIMESTAMPTZ,
//      rejected_at TIMESTAMPTZ, reject_reason TEXT
//    );
//    CREATE TABLE progress (
//      user_id TEXT, key TEXT, level INTEGER DEFAULT 0, score INTEGER DEFAULT 0,
//      PRIMARY KEY (user_id, key)
//    );
//    CREATE TABLE reset_requests (
//      id TEXT PRIMARY KEY, user_id TEXT, user_name TEXT, user_email TEXT,
//      user_phone TEXT, requested_at TIMESTAMPTZ DEFAULT NOW(), status TEXT DEFAULT 'pending'
//    );
//
// 3. Di Leapcell → Environment Variables, tambahkan:
//    SUPABASE_URL = https://xxxxxx.supabase.co
//    SUPABASE_KEY = eyJ... (anon key dari Supabase → Settings → API)
//    JWT_SECRET   = random-string-panjang-aman
//    ADMIN_EMAIL  = email kamu (penerima notifikasi)
//    EMAIL_USER   = gmail kamu
//    EMAIL_PASS   = app password gmail (bukan password biasa!)
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
const PORT       = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'ganti-secret-ini';
const ADMIN_URL  = 'https://polyglotquest.netlify.app/admin.html';
const GAME_URL   = 'https://polyglotquest.netlify.app/game.html';

app.use(cors({ origin: '*', methods: ['GET','POST','PUT','DELETE','OPTIONS'], allowedHeaders: ['Content-Type','Authorization'] }));
app.options('*', cors());
app.use(express.json());

const UPLOAD_DIR = '/tmp/uploads';
const storage = multer.diskStorage({ destination: UPLOAD_DIR, filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname) });
const upload = multer({ storage });
app.use('/uploads', express.static(UPLOAD_DIR));

const transporter = nodemailer.createTransport({ service: 'gmail', auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS } });
async function sendMail(to, subject, html) {
    try { if (!process.env.EMAIL_USER || !to) return; await transporter.sendMail({ from: `"PolyglotQuest" <${process.env.EMAIL_USER}>`, to, subject, html }); }
    catch(e) { console.error('Email gagal:', e.message); }
}

// ── SUPABASE SETUP ────────────────────────────────────────────────────────────
let supabase = null;
const USE_SUPABASE = !!(process.env.SUPABASE_URL && process.env.SUPABASE_KEY);
if (USE_SUPABASE) {
    const { createClient } = require('@supabase/supabase-js');
    supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
    console.log('✓ Supabase aktif - data PERMANEN');
} else {
    console.log('⚠️  Supabase belum dikonfigurasi! Data akan hilang saat server restart.');
}

// ── FALLBACK DB ───────────────────────────────────────────────────────────────
const DB_DIR = '/tmp/database';
const FILES = { users: `${DB_DIR}/users.json`, payments: `${DB_DIR}/payments.json`, progress: `${DB_DIR}/progress.json`, resets: `${DB_DIR}/resets.json` };
async function rf(f) { try { return JSON.parse(await fs.readFile(f, 'utf8')); } catch { return f === FILES.progress ? {} : []; } }
async function wf(f, d) { await fs.writeFile(f, JSON.stringify(d, null, 2)); }

// ── AUTH ──────────────────────────────────────────────────────────────────────
function auth(req, res, next) {
    const token = (req.headers['authorization'] || '').split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Token diperlukan' });
    jwt.verify(token, JWT_SECRET, (err, dec) => { if (err) return res.status(403).json({ error: 'Token tidak valid' }); req.userId = dec.userId; next(); });
}

// ── DB HELPERS ────────────────────────────────────────────────────────────────
function mapUser(u) { return { id: u.id, name: u.name, email: u.email, phone: u.phone, password: u.password, freeTrials: u.free_trials ?? u.freeTrials, points: u.points, createdAt: u.created_at ?? u.createdAt }; }
function mapPayment(p) { return { id: p.id, userId: p.user_id ?? p.userId, userName: p.user_name ?? p.userName, userEmail: p.user_email ?? p.userEmail, packageName: p.package_name ?? p.packageName, packageType: p.package_type ?? p.packageType, amount: p.amount, points: p.points, method: p.method, proofImage: p.proof_image ?? p.proofImage, status: p.status, createdAt: p.created_at ?? p.createdAt, approvedAt: p.approved_at ?? p.approvedAt, rejectedAt: p.rejected_at ?? p.rejectedAt, rejectReason: p.reject_reason ?? p.rejectReason }; }

async function dbGetUserByEmail(email) {
    if (USE_SUPABASE) { const {data} = await supabase.from('users').select('*').eq('email',email).single(); return data ? mapUser(data) : null; }
    const u = (await rf(FILES.users)).find(u=>u.email===email); return u || null;
}
async function dbGetUserById(id) {
    if (USE_SUPABASE) { const {data} = await supabase.from('users').select('*').eq('id',id).single(); return data ? mapUser(data) : null; }
    const u = (await rf(FILES.users)).find(u=>u.id===id); return u || null;
}
async function dbPhoneExists(phone) {
    if (USE_SUPABASE) { const {data} = await supabase.from('users').select('id').eq('phone',phone); return data && data.length > 0; }
    return (await rf(FILES.users)).some(u=>u.phone===phone);
}
async function dbCreateUser(user) {
    if (USE_SUPABASE) { const {error} = await supabase.from('users').insert({id:user.id,name:user.name,email:user.email,phone:user.phone,password:user.password,free_trials:user.freeTrials,points:user.points}); if(error) throw new Error(error.message); return; }
    const users = await rf(FILES.users); users.push(user); await wf(FILES.users, users);
}
async function dbUpdateUser(id, fields) {
    if (USE_SUPABASE) { const db = {}; if(fields.freeTrials!==undefined) db.free_trials=fields.freeTrials; if(fields.points!==undefined) db.points=fields.points; if(fields.password!==undefined) db.password=fields.password; const {error}=await supabase.from('users').update(db).eq('id',id); if(error) throw new Error(error.message); return; }
    const users = await rf(FILES.users); const i=users.findIndex(u=>u.id===id); if(i!==-1){Object.assign(users[i],fields);await wf(FILES.users,users);}
}
async function dbGetAllUsers() {
    if (USE_SUPABASE) { const {data,error}=await supabase.from('users').select('*').order('created_at',{ascending:false}); if(error) throw new Error(error.message); return data.map(mapUser); }
    return (await rf(FILES.users)).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
}
async function dbGetPayments() {
    if (USE_SUPABASE) { const {data,error}=await supabase.from('payments').select('*').order('created_at',{ascending:false}); if(error) throw new Error(error.message); return data.map(mapPayment); }
    return (await rf(FILES.payments)).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
}
async function dbGetPaymentsByUser(userId) {
    if (USE_SUPABASE) { const {data}=await supabase.from('payments').select('*').eq('user_id',userId).order('created_at',{ascending:false}); return (data||[]).map(mapPayment); }
    return (await rf(FILES.payments)).filter(p=>p.userId===userId);
}
async function dbCreatePayment(p) {
    if (USE_SUPABASE) { const {error}=await supabase.from('payments').insert({id:p.id,user_id:p.userId,user_name:p.userName,user_email:p.userEmail,package_name:p.packageName,package_type:p.packageType,amount:p.amount,points:p.points,method:p.method,proof_image:p.proofImage,status:'pending'}); if(error) throw new Error(error.message); return; }
    const payments=await rf(FILES.payments); payments.push(p); await wf(FILES.payments,payments);
}
async function dbUpdatePayment(id, fields) {
    if (USE_SUPABASE) { const db={}; if(fields.status) db.status=fields.status; if(fields.approvedAt) db.approved_at=fields.approvedAt; if(fields.rejectedAt) db.rejected_at=fields.rejectedAt; if(fields.rejectReason) db.reject_reason=fields.rejectReason; const {error}=await supabase.from('payments').update(db).eq('id',id); if(error) throw new Error(error.message); return; }
    const payments=await rf(FILES.payments); const i=payments.findIndex(p=>p.id===id); if(i!==-1){Object.assign(payments[i],fields);await wf(FILES.payments,payments);}
}
async function dbGetPaymentById(id) {
    if (USE_SUPABASE) { const {data}=await supabase.from('payments').select('*').eq('id',id).single(); return data?mapPayment(data):null; }
    return (await rf(FILES.payments)).find(p=>p.id===id)||null;
}
async function dbGetProgress(userId) {
    if (USE_SUPABASE) { const {data}=await supabase.from('progress').select('*').eq('user_id',userId); const r={}; (data||[]).forEach(x=>{r[x.key]={level:x.level,score:x.score};}); return r; }
    return (await rf(FILES.progress))[userId]||{};
}
async function dbUpsertProgress(userId,key,level,score) {
    if (USE_SUPABASE) { const {data:ex}=await supabase.from('progress').select('*').eq('user_id',userId).eq('key',key).single(); if(ex){await supabase.from('progress').update({level:Math.max(ex.level,level),score:ex.score+score}).eq('user_id',userId).eq('key',key);}else{await supabase.from('progress').insert({user_id:userId,key,level,score});} return; }
    const all=await rf(FILES.progress); if(!all[userId])all[userId]={}; if(!all[userId][key])all[userId][key]={level:0,score:0}; all[userId][key].level=Math.max(all[userId][key].level,level); all[userId][key].score+=score; await wf(FILES.progress,all);
}
async function dbAddResetRequest(req) {
    if (USE_SUPABASE) { await supabase.from('reset_requests').insert({id:req.id,user_id:req.userId,user_name:req.userName,user_email:req.userEmail,user_phone:req.userPhone}); return; }
    const resets=await rf(FILES.resets); resets.push({id:req.id,userId:req.userId,name:req.userName,email:req.userEmail,phone:req.userPhone,requestedAt:new Date().toISOString(),status:'pending'}); await wf(FILES.resets,resets);
}
async function dbGetResets() {
    if (USE_SUPABASE) { const {data}=await supabase.from('reset_requests').select('*').order('requested_at',{ascending:false}); return (data||[]).map(r=>({id:r.id,userId:r.user_id,name:r.user_name,email:r.user_email,phone:r.user_phone,requestedAt:r.requested_at})); }
    return (await rf(FILES.resets)).sort((a,b)=>new Date(b.requestedAt)-new Date(a.requestedAt));
}

// ============================================================================
// ENDPOINTS
// ============================================================================

app.post('/api/auth/register', async (req, res) => {
    try {
        const { name, email, password, phone } = req.body;
        if (!name||!email||!password||!phone) return res.status(400).json({ error: 'Semua field wajib diisi (nama, email, password, no. HP)' });
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Format email tidak valid' });
        if (password.length < 6) return res.status(400).json({ error: 'Password minimal 6 karakter' });
        const phoneDigits = phone.replace(/[\s\-\+]/g,'');
        if (!/^\d{10,15}$/.test(phoneDigits)) return res.status(400).json({ error: 'Format no. ponsel tidak valid (10-15 digit)' });
        if (await dbGetUserByEmail(email)) return res.status(400).json({ error: 'Email sudah terdaftar' });
        if (await dbPhoneExists(phoneDigits)) return res.status(400).json({ error: 'No. ponsel sudah terdaftar' });
        const newUser = { id: Date.now().toString(), name, email, phone: phoneDigits, password: await bcrypt.hash(password, 10), freeTrials: 5, points: 0, createdAt: new Date().toISOString() };
        await dbCreateUser(newUser);
        await sendMail(process.env.ADMIN_EMAIL,'🎉 User Baru - PolyglotQuest',`<div style="font-family:Arial;padding:20px;"><h2 style="color:#6366f1;">👤 User Baru</h2><p><b>Nama:</b> ${name}</p><p><b>Email:</b> ${email}</p><p><b>HP:</b> ${phone}</p><a href="https://wa.me/${phoneDigits}" style="background:#25D366;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;display:inline-block;margin-top:12px;">💬 WhatsApp</a></div>`);
        res.json({ message: 'Registrasi berhasil', user: { id: newUser.id, name, email, phone } });
    } catch(e) { console.error(e); res.status(500).json({ error: 'Server error: ' + e.message }); }
});

app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await dbGetUserByEmail(email);
        if (!user) return res.status(401).json({ error: 'Email tidak terdaftar' });
        if (!await bcrypt.compare(password, user.password)) return res.status(401).json({ error: 'Password salah' });
        const token = jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, { expiresIn: '30d' });
        res.json({ token, user: { id: user.id, name: user.name, email: user.email, freeTrials: user.freeTrials, points: user.points } });
    } catch(e) { res.status(500).json({ error: 'Server error' }); }
});

app.get('/api/auth/me', auth, async (req, res) => {
    try { const user = await dbGetUserById(req.userId); if (!user) return res.status(404).json({ error: 'User tidak ditemukan' }); res.json({ id: user.id, name: user.name, email: user.email, freeTrials: user.freeTrials, points: user.points }); }
    catch(e) { res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/auth/reset-request', async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) return res.status(400).json({ error: 'Email harus diisi' });
        const user = await dbGetUserByEmail(email);
        if (user) {
            await dbAddResetRequest({ id: Date.now().toString(), userId: user.id, userName: user.name, userEmail: user.email, userPhone: user.phone || '-' });
            await sendMail(process.env.ADMIN_EMAIL,'🔑 Reset Password - PolyglotQuest',`<div style="font-family:Arial;padding:20px;"><h2>🔑 Reset Diminta</h2><p><b>Nama:</b> ${user.name}</p><p><b>Email:</b> ${user.email}</p><a href="${ADMIN_URL}" style="background:#6366f1;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;display:inline-block;margin-top:12px;">Buka Admin Panel</a></div>`);
        }
        res.json({ message: 'Jika email terdaftar, permintaan telah dikirim ke admin.' });
    } catch(e) { res.status(500).json({ error: 'Server error' }); }
});

app.get('/api/progress', auth, async (req, res) => {
    try { res.json(await dbGetProgress(req.userId)); } catch(e) { res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/progress', auth, async (req, res) => {
    try {
        const { languageId, difficultyId, level, score } = req.body;
        const user = await dbGetUserById(req.userId);
        if (!user) return res.status(404).json({ error: 'User tidak ditemukan' });
        if (user.freeTrials > 0) await dbUpdateUser(req.userId, { freeTrials: user.freeTrials - 1 });
        else if (user.points > 0) await dbUpdateUser(req.userId, { points: user.points - 1 });
        else return res.status(403).json({ error: 'Trial dan poin habis. Silakan beli paket.' });
        await dbUpsertProgress(req.userId, `${languageId}_${difficultyId}`, level||0, score||0);
        res.json({ message: 'Progress tersimpan', progress: await dbGetProgress(req.userId) });
    } catch(e) { res.status(500).json({ error: 'Server error: ' + e.message }); }
});

app.post('/api/payment/submit', auth, upload.single('proof'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'Bukti transfer wajib diupload' });
        const { packageType, method } = req.body;
        const validPkgs = { single: { points:300, price:15000, name:'Single Language (300 pts)' }, full: { points:2100, price:49000, name:'Full Access 7-in-1 (2,100 pts)' } };
        const pkg = validPkgs[packageType];
        if (!pkg) return res.status(400).json({ error: 'Paket tidak valid' });
        const user = await dbGetUserById(req.userId);
        if (!user) return res.status(404).json({ error: 'User tidak ditemukan' });
        const payment = { id: Date.now().toString(), userId: req.userId, userName: user.name, userEmail: user.email, packageType, packageName: pkg.name, points: pkg.points, amount: pkg.price, method: method||'-', proofImage: `/uploads/${req.file.filename}`, status:'pending', createdAt: new Date().toISOString() };
        await dbCreatePayment(payment);
        await sendMail(process.env.ADMIN_EMAIL,'💳 Pembayaran Baru - PolyglotQuest',`<div style="font-family:Arial;padding:20px;"><h2 style="color:#f59e0b;">💳 Pembayaran Baru</h2><p><b>User:</b> ${user.name} (${user.email})</p><p><b>Paket:</b> ${pkg.name}</p><p><b>Total:</b> Rp ${pkg.price.toLocaleString('id-ID')}</p><a href="${ADMIN_URL}" style="background:#6366f1;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;display:inline-block;margin-top:12px;">Buka Admin Panel</a></div>`);
        await sendMail(user.email,'✅ Pembayaran Diterima - PolyglotQuest',`<div style="font-family:Arial;padding:20px;"><h2 style="color:#10b981;">✅ Pembayaran Diterima</h2><p>Halo <b>${user.name}</b>, pembayaran sedang diverifikasi.</p><p><b>Paket:</b> ${pkg.name} | Rp ${pkg.price.toLocaleString('id-ID')}</p><p>Points masuk setelah admin approve (maks 1x24 jam).</p></div>`);
        res.json({ success: true, message: 'Pembayaran disubmit, menunggu verifikasi admin.', payment });
    } catch(e) { console.error(e); res.status(500).json({ error: 'Server error: ' + e.message }); }
});

app.get('/api/payments/user', auth, async (req, res) => {
    try { res.json(await dbGetPaymentsByUser(req.userId)); } catch(e) { res.status(500).json({ error: 'Server error' }); }
});

app.get('/api/admin/payments/all', async (req, res) => {
    try { res.json(await dbGetPayments()); } catch(e) { res.status(500).json({ error: 'Server error: ' + e.message }); }
});

app.post('/api/admin/payments/:id/approve', async (req, res) => {
    try {
        const payment = await dbGetPaymentById(req.params.id);
        if (!payment) return res.status(404).json({ error: 'Tidak ditemukan' });
        if (payment.status !== 'pending') return res.status(400).json({ error: 'Sudah diproses' });
        await dbUpdatePayment(req.params.id, { status:'approved', approvedAt: new Date().toISOString() });
        const user = await dbGetUserById(payment.userId);
        if (user) await dbUpdateUser(payment.userId, { points: user.points + payment.points });
        await sendMail(payment.userEmail,'🎉 Pembayaran Disetujui - PolyglotQuest',`<div style="font-family:Arial;padding:20px;"><h2 style="color:#10b981;">🎉 Disetujui!</h2><p><b>+${payment.points} Points</b> sudah masuk ke akun kamu!</p><a href="${GAME_URL}" style="background:#6366f1;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;display:inline-block;margin-top:12px;">Mulai Belajar</a></div>`);
        res.json({ message: 'Diapprove' });
    } catch(e) { res.status(500).json({ error: 'Server error: ' + e.message }); }
});

app.post('/api/admin/payments/:id/reject', async (req, res) => {
    try {
        const { reason } = req.body;
        const payment = await dbGetPaymentById(req.params.id);
        if (!payment) return res.status(404).json({ error: 'Tidak ditemukan' });
        await dbUpdatePayment(req.params.id, { status:'rejected', rejectedAt: new Date().toISOString(), rejectReason: reason||'Bukti tidak valid' });
        await sendMail(payment.userEmail,'❌ Pembayaran Ditolak - PolyglotQuest',`<div style="font-family:Arial;padding:20px;"><h2 style="color:#ef4444;">❌ Ditolak</h2><p><b>Alasan:</b> ${reason||'Bukti tidak valid'}</p><p>Silakan coba lagi dengan bukti yang valid.</p></div>`);
        res.json({ message: 'Ditolak' });
    } catch(e) { res.status(500).json({ error: 'Server error: ' + e.message }); }
});

app.get('/api/admin/users', async (req, res) => {
    try { res.json(await dbGetAllUsers()); } catch(e) { res.status(500).json({ error: 'Server error: ' + e.message }); }
});

app.post('/api/admin/users/:userId/password', async (req, res) => {
    try {
        const { newPassword } = req.body;
        if (!newPassword||newPassword.length<6) return res.status(400).json({ error: 'Password minimal 6 karakter' });
        const user = await dbGetUserById(req.params.userId);
        if (!user) return res.status(404).json({ error: 'User tidak ditemukan' });
        await dbUpdateUser(req.params.userId, { password: await bcrypt.hash(newPassword, 10) });
        await sendMail(user.email,'🔑 Password Direset - PolyglotQuest',`<div style="font-family:Arial;padding:20px;"><h2>🔑 Password Direset</h2><p>Halo <b>${user.name}</b>, password kamu telah diganti oleh admin.</p><p><b>Password Baru:</b> <code>${newPassword}</code></p><a href="${GAME_URL}" style="background:#6366f1;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;display:inline-block;margin-top:12px;">Login Sekarang</a></div>`);
        res.json({ message: 'Password berhasil diganti' });
    } catch(e) { res.status(500).json({ error: 'Server error: ' + e.message }); }
});

app.post('/api/admin/users/:userId/add-trial', async (req, res) => {
    try {
        const user = await dbGetUserById(req.params.userId);
        if (!user) return res.status(404).json({ error: 'User tidak ditemukan' });
        await dbUpdateUser(req.params.userId, { freeTrials: (user.freeTrials||0) + 1 });
        res.json({ message: 'Trial ditambahkan', freeTrials: (user.freeTrials||0) + 1 });
    } catch(e) { res.status(500).json({ error: 'Server error: ' + e.message }); }
});

app.get('/api/admin/reset-requests', async (req, res) => {
    try { res.json(await dbGetResets()); } catch(e) { res.status(500).json({ error: 'Server error: ' + e.message }); }
});

app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', supabase: USE_SUPABASE, time: new Date().toISOString() });
});

async function start() {
    if (!USE_SUPABASE) { await fs.mkdir(DB_DIR,{recursive:true}); await fs.mkdir(UPLOAD_DIR,{recursive:true}); for(const [f,d] of [[FILES.users,'[]'],[FILES.payments,'[]'],[FILES.progress,'{}'],[FILES.resets,'[]']]) { try{await fs.access(f);}catch{await fs.writeFile(f,d);} } }
    app.listen(PORT, '0.0.0.0', () => console.log(`PolyglotQuest backend PORT:${PORT} | Supabase:${USE_SUPABASE}`));
}
start().catch(console.error);
