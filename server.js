// ============================================================================
// PolyglotQuest — Backend API (Supabase Edition)
// ============================================================================

require('dotenv').config();

const express    = require('express');
const cors       = require('cors');
const bcrypt     = require('bcryptjs');
const jwt        = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const { createClient } = require('@supabase/supabase-js');

const app        = express();
const PORT       = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'ganti-secret-ini';
const ADMIN_URL  = process.env.ADMIN_URL  || 'https://polyglotquest.netlify.app/admin.html';
const GAME_URL   = process.env.GAME_URL   || 'https://polyglotquest.netlify.app/game.html';

// ── SUPABASE ──────────────────────────────────────────────────────────────────
const SUPABASE_URL  = process.env.SUPABASE_URL  || 'https://nshnhqjelnbnkyvljraf.supabase.co';
const SUPABASE_KEY  = process.env.SUPABASE_KEY  || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5zaG5ocWplbG5ibmt5dmxqcmFmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE0MjM4MjYsImV4cCI6MjA4Njk5OTgyNn0.ZkYNb-ZeGWS5IpLIXmrOci9oRSlLyTY8nAGKOHQKHJo';
const supabase      = createClient(SUPABASE_URL, SUPABASE_KEY);

// ── CORS ──────────────────────────────────────────────────────────────────────
const corsOptions = {
    origin: '*',
    methods: ['GET','POST','PUT','DELETE','OPTIONS','PATCH'],
    allowedHeaders: ['Content-Type','Authorization','x-admin-password','X-Admin-Password'],
    credentials: false
};
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));
app.use(express.json());

// ── EMAIL ─────────────────────────────────────────────────────────────────────
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
});
async function sendMail(to, subject, html) {
    try {
        await transporter.sendMail({
            from: `"PolyglotQuest" <${process.env.EMAIL_USER}>`,
            to, subject, html
        });
        console.log('✓ Email terkirim ke', to);
    } catch(e) { console.error('Email gagal:', e.message); }
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

// ── SUPABASE HELPERS ──────────────────────────────────────────────────────────
async function getUser(id) {
    const { data } = await supabase.from('users').select('*').eq('id', id).single();
    return data;
}
async function getUserByEmail(email) {
    const { data } = await supabase.from('users').select('*').eq('email', email).single();
    return data;
}
async function updateUser(id, updates) {
    const { data, error } = await supabase.from('users').update(updates).eq('id', id).select().single();
    if (error) throw error;
    return data;
}

// ============================================================================
// HEALTH CHECK
// ============================================================================

app.get('/api/ping', (req, res) => res.json({ ok: true, ts: Date.now(), db: 'supabase' }));

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
        if (password.length < 6)
            return res.status(400).json({ error: 'Password minimal 6 karakter' });

        const phoneDigits = phone.replace(/[\s\-\+]/g, '');
        if (!/^\d{10,15}$/.test(phoneDigits))
            return res.status(400).json({ error: 'Format no. ponsel tidak valid' });

        // Cek email sudah terdaftar
        const existing = await getUserByEmail(email);
        if (existing) return res.status(400).json({ error: 'Email sudah terdaftar' });

        // Cek phone
        const { data: phoneCheck } = await supabase.from('users').select('id').eq('phone', phone).single();
        if (phoneCheck) return res.status(400).json({ error: 'No. ponsel sudah terdaftar' });

        const newUser = {
            id: Date.now().toString(),
            name, email, phone,
            password: await bcrypt.hash(password, 10),
            free_trials: 5,
            points: 0
        };

        const { error: insertErr } = await supabase.from('users').insert([newUser]);
        if (insertErr) throw insertErr;

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
        const user = await getUserByEmail(email);
        if (!user) return res.status(401).json({ error: 'Email tidak terdaftar' });
        if (!await bcrypt.compare(password, user.password))
            return res.status(401).json({ error: 'Password salah' });

        const token = jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, { expiresIn: '30d' });
        res.json({
            token,
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                freeTrials: user.free_trials,
                points: user.points
            }
        });
    } catch(e) {
        console.error(e);
        res.status(500).json({ error: 'Terjadi kesalahan server' });
    }
});

// GET PROFIL
app.get('/api/auth/me', auth, async (req, res) => {
    try {
        const user = await getUser(req.userId);
        if (!user) return res.status(404).json({ error: 'User tidak ditemukan' });
        res.json({
            id: user.id,
            name: user.name,
            email: user.email,
            freeTrials: user.free_trials,
            points: user.points
        });
    } catch(e) {
        console.error(e);
        res.status(500).json({ error: 'Terjadi kesalahan server' });
    }
});

// REQUEST RESET PASSWORD
app.post('/api/auth/reset-request', async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) return res.status(400).json({ error: 'Email harus diisi' });

        const user = await getUserByEmail(email);
        if (user) {
            await supabase.from('reset_requests').insert([{
                id: Date.now().toString(),
                user_id: user.id,
                user_name: user.name,
                user_email: user.email,
                user_phone: user.phone || '-',
                status: 'pending'
            }]);

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

        res.json({ message: 'Jika email terdaftar, permintaan telah dikirim ke admin.' });
    } catch(e) {
        res.status(500).json({ error: 'Terjadi kesalahan server' });
    }
});

// ============================================================================
// DEDUCT TRIAL / POINTS — sinkron antar semua device
// ============================================================================

app.post('/api/user/deduct', auth, async (req, res) => {
    try {
        const { trialCost = 0, pointCost = 0 } = req.body;

        const user = await getUser(req.userId);
        if (!user) return res.status(404).json({ error: 'User tidak ditemukan' });

        const curTrials = user.free_trials || 0;
        const curPoints = user.points || 0;

        if (trialCost > 0 && curTrials < trialCost)
            return res.status(400).json({ error: 'Trial tidak cukup', freeTrials: curTrials, points: curPoints });
        if (pointCost > 0 && curPoints < pointCost)
            return res.status(400).json({ error: 'Points tidak cukup', freeTrials: curTrials, points: curPoints });

        const updated = await updateUser(req.userId, {
            free_trials: curTrials - trialCost,
            points: curPoints - pointCost
        });

        res.json({ success: true, freeTrials: updated.free_trials, points: updated.points });
    } catch(e) {
        console.error(e);
        res.status(500).json({ error: 'Server error' });
    }
});

// ============================================================================
// PROGRESS
// ============================================================================

app.get('/api/progress', auth, async (req, res) => {
    try {
        const { data } = await supabase.from('progress').select('*').eq('user_id', req.userId);
        const result = {};
        (data || []).forEach(row => { result[row.key] = { level: row.level, score: row.score }; });
        res.json(result);
    } catch(e) { res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/progress', auth, async (req, res) => {
    try {
        const { languageId, difficultyId, level, score } = req.body;
        const key = `${languageId}_${difficultyId}`;

        const { data: existing } = await supabase.from('progress')
            .select('*').eq('user_id', req.userId).eq('key', key).single();

        if (existing) {
            await supabase.from('progress').update({
                level: Math.max(existing.level, level),
                score: existing.score + score
            }).eq('user_id', req.userId).eq('key', key);
        } else {
            await supabase.from('progress').insert([{
                user_id: req.userId, key, level, score
            }]);
        }

        res.json({ message: 'Progress tersimpan' });
    } catch(e) { res.status(500).json({ error: 'Server error' }); }
});

// ============================================================================
// PAYMENT
// ============================================================================

app.post('/api/payment/submit', auth, async (req, res) => {
    try {
        const { package: pkgRaw, packageName, packageType, points, amount, method, proof } = req.body;

        const user = await getUser(req.userId);
        if (!user) return res.status(404).json({ error: 'User tidak ditemukan' });

        const pkgName   = packageName || pkgRaw || 'Custom';
        const pkgPoints = parseInt(points) || 0;
        const pkgAmount = parseInt(amount) || 0;

        const payment = {
            id: Date.now().toString(),
            user_id: req.userId,
            user_name: user.name,
            user_email: user.email,
            package_name: pkgName,
            package_type: packageType || 'custom',
            points: pkgPoints,
            amount: pkgAmount,
            method: method || '-',
            proof_image: proof || null,
            status: 'pending'
        };

        const { error: insertErr } = await supabase.from('payments').insert([payment]);
        if (insertErr) throw insertErr;

        await sendMail(
            process.env.ADMIN_EMAIL,
            '💳 Pembayaran Baru - PolyglotQuest',
            `<div style="font-family:Arial;padding:20px;">
            <h2 style="color:#f59e0b;">💳 Pembayaran Baru</h2>
            <p><b>User:</b> ${user.name} (${user.email})</p>
            <p><b>Paket:</b> ${pkgName}</p>
            <p><b>Total:</b> Rp ${pkgAmount.toLocaleString('id-ID')}</p>
            <p><b>Metode:</b> ${method}</p>
            <a href="${ADMIN_URL}" style="display:inline-block;background:#6366f1;color:#fff;padding:10px 22px;border-radius:8px;text-decoration:none;margin-top:12px;">Buka Admin Panel</a></div>`
        );
        await sendMail(
            user.email,
            '✅ Pembayaran Diterima - PolyglotQuest',
            `<div style="font-family:Arial;padding:20px;">
            <h2 style="color:#10b981;">✅ Pembayaran Diterima</h2>
            <p>Halo <b>${user.name}</b>, pembayaran kamu sedang diverifikasi.</p>
            <p><b>Paket:</b> ${pkgName} | <b>Total:</b> Rp ${pkgAmount.toLocaleString('id-ID')}</p>
            <p>Points akan masuk otomatis setelah admin menyetujui (maks 1x24 jam).</p></div>`
        );

        res.json({ success: true, message: 'Pembayaran disubmit.', id: payment.id, payment });
    } catch(e) {
        console.error(e);
        res.status(500).json({ error: 'Server error' });
    }
});

app.get('/api/payments/user', auth, async (req, res) => {
    try {
        const { data } = await supabase.from('payments').select('*').eq('user_id', req.userId).order('created_at', { ascending: false });
        res.json(data || []);
    } catch(e) { res.status(500).json({ error: 'Server error' }); }
});

// ============================================================================
// ADMIN — PAYMENTS
// ============================================================================

app.get('/api/admin/payments/all', async (req, res) => {
    try {
        const { data } = await supabase.from('payments').select('*').order('created_at', { ascending: false });
        res.json(data || []);
    } catch(e) { res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/admin/payments/:id/approve', async (req, res) => {
    try {
        const { data: payment } = await supabase.from('payments').select('*').eq('id', req.params.id).single();
        if (!payment) return res.status(404).json({ error: 'Tidak ditemukan' });
        if (payment.status !== 'pending') return res.status(400).json({ error: 'Sudah diproses' });

        await supabase.from('payments').update({
            status: 'approved',
            approved_at: new Date().toISOString()
        }).eq('id', req.params.id);

        const user = await getUser(payment.user_id);
        if (user) {
            await updateUser(payment.user_id, { points: (user.points || 0) + payment.points });
        }

        await sendMail(
            payment.user_email,
            '🎉 Pembayaran Disetujui - PolyglotQuest',
            `<div style="font-family:Arial;padding:20px;">
            <h2 style="color:#10b981;">🎉 Pembayaran Disetujui!</h2>
            <p><b>+${payment.points} Points</b> sudah masuk ke akun kamu!</p>
            <a href="${GAME_URL}" style="display:inline-block;background:#6366f1;color:#fff;padding:10px 22px;border-radius:8px;text-decoration:none;margin-top:12px;">Mulai Belajar</a></div>`
        );

        res.json({ message: 'Diapprove' });
    } catch(e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/admin/payments/:id/reject', async (req, res) => {
    try {
        const { reason } = req.body;
        const { data: payment } = await supabase.from('payments').select('*').eq('id', req.params.id).single();
        if (!payment) return res.status(404).json({ error: 'Tidak ditemukan' });

        await supabase.from('payments').update({
            status: 'rejected',
            rejected_at: new Date().toISOString(),
            reject_reason: reason || 'Bukti tidak valid'
        }).eq('id', req.params.id);

        await sendMail(
            payment.user_email,
            '❌ Pembayaran Ditolak - PolyglotQuest',
            `<div style="font-family:Arial;padding:20px;">
            <h2 style="color:#ef4444;">❌ Pembayaran Ditolak</h2>
            <p><b>Alasan:</b> ${reason || 'Bukti tidak valid'}</p>
            <p>Silakan coba lagi dengan bukti yang valid.</p></div>`
        );

        res.json({ message: 'Ditolak' });
    } catch(e) { res.status(500).json({ error: 'Server error' }); }
});

// ============================================================================
// ADMIN — USERS
// ============================================================================

app.get('/api/admin/users', async (req, res) => {
    try {
        const { data } = await supabase.from('users')
            .select('id,name,email,phone,password,free_trials,points,created_at')
            .order('created_at', { ascending: false });
        const result = (data || []).map(u => ({
            id: u.id,
            name: u.name,
            email: u.email,
            phone: u.phone || '-',
            password: u.password,
            freeTrials: u.free_trials,
            points: u.points,
            createdAt: u.created_at
        }));
        res.json(result);
    } catch(e) { res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/admin/users/:userId/password', async (req, res) => {
    try {
        const { newPassword } = req.body;
        if (!newPassword || newPassword.length < 6)
            return res.status(400).json({ error: 'Password minimal 6 karakter' });

        const user = await getUser(req.params.userId);
        if (!user) return res.status(404).json({ error: 'User tidak ditemukan' });

        await updateUser(req.params.userId, { password: await bcrypt.hash(newPassword, 10) });

        await sendMail(
            user.email,
            '🔑 Password Akun Direset - PolyglotQuest',
            `<div style="font-family:Arial;padding:20px;">
            <h2 style="color:#6366f1;">🔑 Password Berhasil Direset</h2>
            <p>Halo <b>${user.name}</b>, password akun kamu telah diganti oleh admin.</p>
            <p><b>Password Baru:</b> <code style="background:#f3f4f6;padding:2px 8px;border-radius:4px;">${newPassword}</code></p>
            <a href="${GAME_URL}" style="display:inline-block;background:#6366f1;color:#fff;padding:10px 22px;border-radius:8px;text-decoration:none;margin-top:12px;">Login Sekarang</a></div>`
        );

        res.json({ message: 'Password berhasil diganti' });
    } catch(e) { res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/admin/users/:userId/add-trial', async (req, res) => {
    try {
        const user = await getUser(req.params.userId);
        if (!user) return res.status(404).json({ error: 'User tidak ditemukan' });
        const updated = await updateUser(req.params.userId, { free_trials: (user.free_trials || 0) + 1 });
        res.json({ message: 'Trial ditambahkan', freeTrials: updated.free_trials });
    } catch(e) { res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/admin/users/:userId/add-points', async (req, res) => {
    try {
        const { points } = req.body;
        if (!points || points <= 0) return res.status(400).json({ error: 'Points tidak valid' });
        const user = await getUser(req.params.userId);
        if (!user) return res.status(404).json({ error: 'User tidak ditemukan' });
        const updated = await updateUser(req.params.userId, { points: (user.points || 0) + parseInt(points) });
        res.json({ message: 'Points ditambahkan', points: updated.points });
    } catch(e) { res.status(500).json({ error: 'Server error' }); }
});

app.get('/api/admin/reset-requests', async (req, res) => {
    try {
        const { data } = await supabase.from('reset_requests').select('*').order('requested_at', { ascending: false });
        const result = (data || []).map(r => ({
            id: r.id,
            userId: r.user_id,
            name: r.user_name,
            email: r.user_email,
            phone: r.user_phone,
            requestedAt: r.requested_at,
            status: r.status
        }));
        res.json(result);
    } catch(e) { res.status(500).json({ error: 'Server error' }); }
});

// ============================================================================
// AI CONVERSATION — Google Gemini 2.0 Flash
// ============================================================================

const https = require('https');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL   = 'gemini-2.0-flash';
const GEMINI_URL     = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

const AI_SYSTEM_PROMPTS = {
    english: `You are Luna, a friendly and encouraging English language tutor on PolyglotQuest.
Your role is to help Indonesian speakers practice conversational English.
Always respond in English, but if the user writes in Indonesian, gently switch them to English with a translation hint.
Keep responses SHORT (2-4 sentences max) and conversational.
If the user makes grammar mistakes, kindly correct them at the end of your reply like: "💡 Tip: Instead of '...' try saying '...'"
Support roleplay scenarios when asked (e.g. at restaurant, airport, hotel, shopping).
Always end with a follow-up question to keep the conversation going.`,

    japanese: `You are Hana (花), a friendly Japanese language tutor on PolyglotQuest.
Help Indonesian speakers practice Japanese conversation.
Use a mix of Japanese and romaji, always provide Indonesian translation in parentheses.
Keep responses SHORT and conversational.
Correct mistakes gently: "💡 Tip: '...' より '...' の方が自然です"
Support roleplay scenarios. Always end with a question to continue conversation.`,

    korean: `You are Soo-Jin (수진), a friendly Korean language tutor on PolyglotQuest.
Help Indonesian speakers practice Korean conversation.
Use Korean with romaji and Indonesian translation in parentheses.
Keep responses SHORT and conversational.
Correct mistakes gently. Always end with a question to keep conversation going.`,

    mandarin: `You are Ming (明), a friendly Mandarin language tutor on PolyglotQuest.
Help Indonesian speakers practice Mandarin conversation.
Use Chinese characters with pinyin and Indonesian translation in parentheses.
Keep responses SHORT and conversational.
Correct mistakes gently. Always end with a question to continue conversation.`,

    arabic: `You are Layla (ليلى), a friendly Arabic language tutor on PolyglotQuest.
Help Indonesian speakers practice Arabic conversation.
Use Arabic script with transliteration and Indonesian translation in parentheses.
Keep responses SHORT and conversational.
Correct mistakes gently. Always end with a question to continue conversation.`,

    french: `You are Sophie, a friendly French language tutor on PolyglotQuest.
Help Indonesian speakers practice French conversation.
Use French with Indonesian translation in parentheses.
Keep responses SHORT and conversational.
Correct mistakes gently. Always end with a question to continue conversation.`,

    spanish: `You are Carlos, a friendly Spanish language tutor on PolyglotQuest.
Help Indonesian speakers practice Spanish conversation.
Use Spanish with Indonesian translation in parentheses.
Keep responses SHORT and conversational.
Correct mistakes gently. Always end with a question to continue conversation.`,

    indonesian: `You are Budi, a friendly language tutor on PolyglotQuest.
Help users practice Indonesian language. Keep responses SHORT and conversational.
Correct mistakes gently. Always end with a question to continue conversation.`
};

// Helper: call Gemini with 1 retry on 429
async function callGemini(body, retries = 1) {
    const urlObj = new URL(GEMINI_URL);
    const options = {
        hostname: urlObj.hostname,
        path: urlObj.pathname + urlObj.search,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    };
    const response = await new Promise((resolve, reject) => {
        const req = https.request(options, (r) => {
            let data = '';
            r.on('data', chunk => data += chunk);
            r.on('end', () => resolve({ status: r.statusCode, body: data }));
        });
        req.on('error', reject);
        req.write(body);
        req.end();
    });
    // Rate limit — wait 2s and retry once
    if (response.status === 429 && retries > 0) {
        await new Promise(r => setTimeout(r, 2000));
        return callGemini(body, retries - 1);
    }
    return response;
}

app.post('/api/ai/chat', async (req, res) => {
    try {
        const { messages, language, scenario } = req.body;
        if (!messages || !language) return res.status(400).json({ error: 'messages dan language wajib diisi' });
        if (!GEMINI_API_KEY) return res.status(500).json({ error: 'GEMINI_API_KEY belum dikonfigurasi di environment variables' });

        const systemPrompt = AI_SYSTEM_PROMPTS[language] || AI_SYSTEM_PROMPTS.english;
        const scenarioNote = scenario ? `\n\nCurrent roleplay scenario: ${scenario}. Stay in character for this scenario.` : '';

        // Gemini requires alternating user/model roles — ensure valid sequence
        let geminiMessages = messages.map(m => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: m.content }]
        }));
        // Must start with user
        if (geminiMessages.length && geminiMessages[0].role === 'model') {
            geminiMessages = geminiMessages.slice(1);
        }
        // Remove consecutive same roles
        const filtered = [];
        for (const msg of geminiMessages) {
            if (!filtered.length || filtered[filtered.length - 1].role !== msg.role) {
                filtered.push(msg);
            }
        }
        if (!filtered.length) filtered.push({ role: 'user', parts: [{ text: 'Hello' }] });

        const body = JSON.stringify({
            system_instruction: { parts: [{ text: systemPrompt + scenarioNote }] },
            contents: filtered,
            generationConfig: {
                temperature: 0.82,
                maxOutputTokens: 350,
                topP: 0.95
            },
            safetySettings: [
                { category: 'HARM_CATEGORY_HARASSMENT',   threshold: 'BLOCK_ONLY_HIGH' },
                { category: 'HARM_CATEGORY_HATE_SPEECH',  threshold: 'BLOCK_ONLY_HIGH' }
            ]
        });

        const response = await callGemini(body);

        if (response.status !== 200) {
            console.error('Gemini error:', response.status, response.body);
            const parsed = (() => { try { return JSON.parse(response.body); } catch { return {}; } })();
            const msg = parsed?.error?.message || ('Gemini API error: ' + response.status);
            return res.status(502).json({ error: msg });
        }

        const result = JSON.parse(response.body);
        const text = result?.candidates?.[0]?.content?.parts?.[0]?.text
                  || 'Maaf, saya tidak bisa merespons saat ini.';
        res.json({ reply: text });

    } catch(e) {
        console.error('AI Chat error:', e);
        res.status(500).json({ error: 'Terjadi kesalahan server' });
    }
});

// ============================================================================
// START
// ============================================================================

async function checkSupabase() {
    try {
        const { error } = await supabase.from('users').select('id').limit(1);
        if (error) throw error;
        console.log('✓ Supabase aktif - data PERMANEN');
    } catch(e) {
        console.error('✗ Supabase error:', e.message);
        console.log('Pastikan SUPABASE_URL dan SUPABASE_KEY sudah benar di environment variables Leapcell.');
    }
}

checkSupabase().then(() => {
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`PolyglotQuest backend PORT:${PORT} | Supabase:true`);
        console.log(`
╔══════════════════════════════════════════╗
║   PolyglotQuest Backend  PORT:${PORT}    ║
║   Database: Supabase (PERMANEN)          ║
╚══════════════════════════════════════════╝
HEALTH  GET  /api/ping
AUTH    POST /api/auth/register
        POST /api/auth/login
        GET  /api/auth/me
        POST /api/auth/reset-request
GAME    POST /api/user/deduct
        GET  /api/progress
        POST /api/progress
        POST /api/payment/submit
        GET  /api/payments/user
ADMIN   GET  /api/admin/users
        POST /api/admin/users/:id/password
        POST /api/admin/users/:id/add-trial
        POST /api/admin/users/:id/add-points
        GET  /api/admin/payments/all
        POST /api/admin/payments/:id/approve
        POST /api/admin/payments/:id/reject
        GET  /api/admin/reset-requests
        `);
    });
});
