const express = require('express');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { getStore } = require('@netlify/blobs');

const app = express();
const DB = path.join(__dirname, 'data.json');
const SECRET = process.env.JWT_SECRET;
const isNetlify = process.env.NETLIFY === 'true' || !!process.env.NETLIFY_DEV || !!process.env.CONTEXT;

const seed = {
  settings: { storeName: 'Nepkits Hub', tagline: 'Jerseys. Streetwear. Nepal.', logo: '/nepkits-hub-logo.svg', paymentQr: '', phone: '', email: '', instagram: '' },
  users: [],
  products: [
    { id: 1, name: 'Nepal Home Jersey 2026', cat: 'Jerseys', price: 1499, stock: 30, image: '', active: true },
    { id: 2, name: 'Kathmandu Street Tee', cat: 'T-Shirts', price: 899, stock: 40, image: '', active: true },
    { id: 3, name: 'Classic Training Hoodie', cat: 'Hoodies', price: 1899, stock: 25, image: '', active: true }
  ],
  orders: []
};

function localRead() {
  if (!fs.existsSync(DB)) fs.writeFileSync(DB, JSON.stringify(seed, null, 2));
  return JSON.parse(fs.readFileSync(DB, 'utf8'));
}
function localWrite(data) { fs.writeFileSync(DB, JSON.stringify(data, null, 2)); }

function store() {
  if (!isNetlify) return null;
  const siteID = process.env.NETLIFY_SITE_ID || process.env.SITE_ID;
  const token = process.env.NETLIFY_API_TOKEN || process.env.NETLIFY_AUTH_TOKEN;
  if (!siteID || !token) {
    throw new Error('Netlify Blobs is not configured. Add NETLIFY_SITE_ID (Project ID) and NETLIFY_API_TOKEN in Netlify environment variables.');
  }
  return getStore('nepkits-hub-data', { siteID, token });
}

async function readData() {
  if (!isNetlify) return localRead();
  const s = store();
  let data = await s.get('data', { type: 'json' });
  if (!data) {
    data = JSON.parse(JSON.stringify(seed));
    await s.setJSON('data', data);
  }
  return data;
}
async function writeData(data) {
  if (!isNetlify) return localWrite(data);
  await store().setJSON('data', data);
}

async function ensureAdmin() {
  if (!SECRET) throw new Error('JWT_SECRET is not configured');
  const data = await readData();
  if (!data.users.some((u) => u.role === 'admin')) {
    if (!process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD) throw new Error('ADMIN_EMAIL and ADMIN_PASSWORD are not configured');
    data.users.push({ id: 1, name: 'Store Admin', email: process.env.ADMIN_EMAIL.trim().toLowerCase(), passwordHash: await bcrypt.hash(process.env.ADMIN_PASSWORD, 10), role: 'admin' });
    await writeData(data);
  }
}

app.use(express.json({ limit: '2mb' }));
app.use(express.static(__dirname));
function token(user) {
  if (!SECRET) throw new Error('JWT_SECRET is not configured');
  return jwt.sign({ id: user.id, role: user.role, email: user.email }, SECRET, { expiresIn: '7d' });
}
function auth(req, res, next) {
  const t = (req.headers.authorization || '').replace('Bearer ', '');
  try { if (!SECRET) throw new Error(); req.user = jwt.verify(t, SECRET); next(); }
  catch { res.status(401).json({ message: 'Authentication required' }); }
}
function admin(req, res, next) { if (req.user?.role !== 'admin') return res.status(403).json({ message: 'Admin only' }); next(); }

app.get('/api/health', async (req, res) => { try { await ensureAdmin(); res.json({ ok: true, storage: isNetlify ? 'netlify-blobs' : 'local' }); } catch (e) { res.status(500).json({ ok: false, message: e.message }); } });
app.get('/api/products', async (req, res) => { try { res.json((await readData()).products.filter(x => x.active !== false)); } catch (e) { res.status(500).json({ message: e.message }); } });
app.get('/api/store/settings', async (req, res) => { try { res.json((await readData()).settings); } catch (e) { res.status(500).json({ message: e.message }); } });
app.post('/api/auth/register', async (req, res) => { try { const d = await readData(); const { name, email, password } = req.body || {}; const normalizedEmail = String(email || '').trim().toLowerCase(); if (!name || !normalizedEmail || !password || password.length < 6) return res.status(400).json({ message: 'Invalid registration' }); if (d.users.some(x => x.email === normalizedEmail)) return res.status(409).json({ message: 'Email already registered' }); const u = { id: Date.now(), name: String(name).trim(), email: normalizedEmail, passwordHash: await bcrypt.hash(password, 10), role: 'customer' }; d.users.push(u); await writeData(d); res.json({ token: token(u), user: { id: u.id, name: u.name, email: u.email, role: u.role } }); } catch (e) { res.status(500).json({ message: e.message }); } });
app.post('/api/auth/login', async (req, res) => { try { await ensureAdmin(); const d = await readData(); const email = String(req.body?.email || '').trim().toLowerCase(); const u = d.users.find(x => x.email === email); if (!u || !(await bcrypt.compare(req.body?.password || '', u.passwordHash))) return res.status(401).json({ message: 'Invalid email or password' }); res.json({ token: token(u), user: { id: u.id, name: u.name, email: u.email, role: u.role } }); } catch (e) { res.status(500).json({ message: e.message }); } });
app.get('/api/orders/my', auth, async (req, res) => { try { res.json((await readData()).orders.filter(o => o.userId === req.user.id)); } catch (e) { res.status(500).json({ message: e.message }); } });
app.post('/api/orders', auth, async (req, res) => { try { const d = await readData(); const o = { id: 'NH-' + Date.now().toString().slice(-8), userId: req.user.id, date: new Date().toISOString(), customer: req.body?.customer, items: req.body?.items || [], total: Number(req.body?.total || 0), status: 'Pending review', paymentProof: req.body?.paymentProof || '' }; d.orders.unshift(o); await writeData(d); res.status(201).json(o); } catch (e) { res.status(500).json({ message: e.message }); } });
app.get('/api/admin/stats', auth, admin, async (req, res) => { try { const d = await readData(); res.json({ products: d.products.filter(x => x.active !== false).length, orders: d.orders.length, customers: d.users.filter(x => x.role === 'customer').length, revenue: d.orders.filter(x => x.status !== 'Cancelled').reduce((s, x) => s + x.total, 0), pending: d.orders.filter(x => !['Delivered', 'Cancelled'].includes(x.status)).length, lowStock: d.products.filter(x => x.stock <= 5).length }); } catch (e) { res.status(500).json({ message: e.message }); } });
app.get('/api/admin/orders', auth, admin, async (req, res) => { try { res.json((await readData()).orders); } catch (e) { res.status(500).json({ message: e.message }); } });
app.get('/api/admin/products', auth, admin, async (req, res) => { try { res.json((await readData()).products); } catch (e) { res.status(500).json({ message: e.message }); } });
app.patch('/api/admin/orders/:id', auth, admin, async (req, res) => { try { const d = await readData(); const o = d.orders.find(x => x.id === req.params.id); if (!o) return res.sendStatus(404); o.status = req.body?.status; await writeData(d); res.json(o); } catch (e) { res.status(500).json({ message: e.message }); } });
app.patch('/api/admin/products/:id', auth, admin, async (req, res) => { try { const d = await readData(); const p = d.products.find(x => x.id === Number(req.params.id)); if (!p) return res.sendStatus(404); Object.assign(p, req.body || {}); await writeData(d); res.json(p); } catch (e) { res.status(500).json({ message: e.message }); } });
app.post('/api/admin/products', auth, admin, async (req, res) => { try { const d = await readData(); const p = { id: Date.now(), name: req.body?.name, cat: req.body?.cat || 'Jerseys', price: Number(req.body?.price || 0), stock: Number(req.body?.stock || 0), image: req.body?.image || '', active: true }; d.products.push(p); await writeData(d); res.status(201).json(p); } catch (e) { res.status(500).json({ message: e.message }); } });
app.patch('/api/admin/settings', auth, admin, async (req, res) => { try { const d = await readData(); d.settings = { ...d.settings, ...(req.body || {}) }; await writeData(d); res.json(d.settings); } catch (e) { res.status(500).json({ message: e.message }); } });

if (require.main === module) app.listen(process.env.PORT || 3000, () => console.log('Nepkits Hub running'));
module.exports = app;
