const express = require('express');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const app = express();
const port = Number(process.env.PORT || 3000);
const webRoot = path.resolve(__dirname, '..', 'frontend');
const dataRoot = path.join(__dirname, 'data');
const dataFile = process.env.HUMUSIQ_DATA_FILE || path.join(dataRoot, 'store.json');
const adminEmail = String(process.env.HUMUSIQ_ADMIN_EMAIL || 'admin@humusiq.farm').trim().toLowerCase();
const adminPassword = process.env.HUMUSIQ_ADMIN_PASSWORD || 'farmadmin123';
const tokens = new Map();
const tokenLifetime = 8 * 60 * 60 * 1000;
const validSections = ['dashboard', 'farmers', 'farms', 'assessments', 'predictions', 'documents', 'verification', 'model-performance', 'reports', 'settings'];

function initialStore() {
  return { farmers: [], assessments: [], predictions: [], settings: { language: 'en', voiceEnabled: true, readinessWeights: { practices: 25, land: 15, documents: 20, soil: 15, irrigation: 15, inputs: 10 } } };
}

function readStore() {
  try {
    const value = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
    const defaults = initialStore();
    return { ...defaults, ...value, farmers: Array.isArray(value.farmers) ? value.farmers : [], assessments: Array.isArray(value.assessments) ? value.assessments : [], predictions: Array.isArray(value.predictions) ? value.predictions : [], settings: { ...defaults.settings, ...(value.settings || {}) } };
  } catch {
    return initialStore();
  }
}

let store = readStore();

function persist() {
  fs.mkdirSync(dataRoot, { recursive: true });
  const temporary = dataFile + '.tmp';
  fs.writeFileSync(temporary, JSON.stringify(store, null, 2), { mode: 0o600 });
  fs.renameSync(temporary, dataFile);
}

function cleanText(value, max = 180) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

function safeAssessment(raw) {
  const item = raw && typeof raw === 'object' ? raw : {};
  const email = cleanText(item.email || item.profile && item.profile.email, 254).toLowerCase();
  const profile = item.profile && typeof item.profile === 'object' ? item.profile : {};
  const land = item.land && typeof item.land === 'object' ? item.land : {};
  return {
    id: cleanText(item.id, 80) || crypto.randomUUID(),
    email,
    name: cleanText(item.name || profile.name, 120) || 'Farmer',
    village: cleanText(item.village || profile.village, 120),
    district: cleanText(item.district || profile.district, 120),
    state: cleanText(item.state || profile.state, 120),
    area: cleanText(item.area || land.area, 40),
    profile: { name: cleanText(profile.name || item.name, 120), email, village: cleanText(profile.village || item.village, 120), district: cleanText(profile.district || item.district, 120), state: cleanText(profile.state || item.state, 120), phone: cleanText(profile.phone, 40) },
    land,
    crops: Array.isArray(item.crops) ? item.crops.slice(0, 80) : [],
    practices: Array.isArray(item.practices) ? item.practices.slice(0, 80) : [],
    inputs: Array.isArray(item.inputs) ? item.inputs.slice(0, 80) : [],
    irrigation: Array.isArray(item.irrigation) ? item.irrigation.slice(0, 80) : [],
    soil: Array.isArray(item.soil) ? item.soil.slice(0, 80) : [],
    water: Array.isArray(item.water) ? item.water.slice(0, 80) : [],
    documents: Array.isArray(item.documents) ? item.documents.slice(0, 80) : [],
    boundary: Array.isArray(item.boundary) ? item.boundary.slice(0, 500) : [],
    result: item.result && typeof item.result === 'object' ? item.result : null,
    verificationStatus: ['approved', 'needs-info', 'rejected'].includes(item.verificationStatus) ? item.verificationStatus : 'pending',
    verificationNote: cleanText(item.verificationNote, 1000),
    updated: cleanText(item.updated, 40) || new Date().toISOString()
  };
}

function upsertByEmail(list, item) {
  const email = cleanText(item.email, 254).toLowerCase();
  const index = email ? list.findIndex(row => row.email === email) : list.findIndex(row => row.id === item.id);
  if (index < 0) list.push(item);
  else list[index] = { ...list[index], ...item, id: list[index].id || item.id };
}

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

function requireAdmin(req, res, next) {
  const header = String(req.headers.authorization || '');
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  const expires = tokens.get(token);
  if (!expires || expires < Date.now()) {
    if (token) tokens.delete(token);
    return res.status(401).json({ error: 'Admin session expired. Please sign in again.' });
  }
  next();
}

function constantTimeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  next();
});
app.use(express.json({ limit: '2mb' }));

app.get('/api/health', (req, res) => res.json({ ok: true, service: 'HumusIQ API', version: 1 }));
app.get('/api/settings', (req, res) => res.json(store.settings));

app.post('/api/admin/login', (req, res) => {
  const email = cleanText(req.body && req.body.email, 254).toLowerCase();
  const password = String(req.body && req.body.password || '');
  if (!constantTimeEqual(email, adminEmail) || !constantTimeEqual(password, adminPassword)) return res.status(401).json({ error: 'Incorrect admin email or password.' });
  const token = crypto.randomBytes(32).toString('hex');
  tokens.set(token, Date.now() + tokenLifetime);
  res.json({ token, email: adminEmail, expiresIn: tokenLifetime });
});

app.use('/api/admin', requireAdmin);

app.get('/api/admin/me', requireAdmin, (req, res) => res.json({ email: adminEmail, role: 'admin' }));
app.post('/api/admin/logout', requireAdmin, (req, res) => {
  const token = String(req.headers.authorization || '').slice(7);
  tokens.delete(token);
  res.json({ ok: true });
});

app.post('/api/sync', (req, res) => {
  const body = req.body || {};
  const account = body.account && typeof body.account === 'object' ? body.account : {};
  const email = cleanText(account.email, 254).toLowerCase();
  if (!email || !email.includes('@')) return res.status(400).json({ error: 'A valid farmer email is required.' });
  const farmer = { email, name: cleanText(account.name, 120) || 'Farmer', created: cleanText(account.created, 40) || new Date().toISOString(), updated: new Date().toISOString() };
  upsertByEmail(store.farmers, farmer);
  if (body.assessment && typeof body.assessment === 'object') {
    const assessment = safeAssessment({ ...body.assessment, email });
    const previous = store.assessments.find(row => row.email === email);
    if (previous) {
      assessment.id = previous.id;
      assessment.verificationStatus = previous.verificationStatus;
      assessment.verificationNote = previous.verificationNote;
    }
    upsertByEmail(store.assessments, assessment);
  }
  persist();
  res.json({ ok: true });
});

app.post('/api/predictions', (req, res) => {
  const body = req.body || {};
  const recommendedCrop = cleanText(body.recommendedCrop, 120);
  if (!recommendedCrop) return res.status(400).json({ error: 'A prediction summary is required.' });
  const signature = [recommendedCrop, cleanText(body.createdAt, 40), cleanText(body.source, 40)].join('|');
  let prediction = store.predictions.find(row => row.signature === signature);
  if (!prediction) {
    prediction = { id: crypto.randomUUID(), signature, recommendedCrop, confidence: Math.max(0, Math.min(100, Number(body.confidence) || 0)), source: 'Prototype rules', status: cleanText(body.status, 40) || 'informational', createdAt: new Date().toISOString() };
    store.predictions.unshift(prediction);
    store.predictions = store.predictions.slice(0, 2000);
    persist();
  }
  res.status(201).json({ ok: true, id: prediction.id });
});

app.use('/api/admin', requireAdmin);

app.post('/api/admin/import-local', (req, res) => {
  const accounts = Array.isArray(req.body && req.body.accounts) ? req.body.accounts : [];
  const assessments = Array.isArray(req.body && req.body.assessments) ? req.body.assessments : [];
  accounts.slice(0, 5000).forEach(raw => {
    const email = cleanText(raw && raw.email, 254).toLowerCase();
    if (email && email.includes('@')) upsertByEmail(store.farmers, { email, name: cleanText(raw.name, 120) || 'Farmer', created: cleanText(raw.created, 40) || new Date().toISOString(), updated: new Date().toISOString() });
  });
  assessments.slice(0, 5000).forEach(raw => {
    const item = safeAssessment(raw);
    const old = store.assessments.find(row => row.email === item.email);
    if (old) {
      item.id = old.id;
      item.verificationStatus = old.verificationStatus;
      item.verificationNote = old.verificationNote;
    }
    upsertByEmail(store.assessments, item);
    if (item.email && !store.farmers.some(row => row.email === item.email)) upsertByEmail(store.farmers, { email: item.email, name: item.name, created: item.updated, updated: item.updated });
  });
  persist();
  res.json({ ok: true, farmers: store.farmers.length, assessments: store.assessments.length });
});

app.get('/api/admin/dashboard', (req, res) => {
  const scores = store.assessments.filter(row => row.result && Number.isFinite(Number(row.result.score)));
  const counts = { high: 0, medium: 0, low: 0 };
  scores.forEach(row => {
    const status = String(row.result.status || '').toLowerCase();
    if (['high', 'green'].includes(status)) counts.high += 1;
    else if (['medium', 'yellow'].includes(status)) counts.medium += 1;
    else counts.low += 1;
  });
  res.json({ farmers: store.farmers.length, farms: store.assessments.length, assessments: scores.length, averageScore: scores.length ? Math.round(scores.reduce((sum, row) => sum + Number(row.result.score), 0) / scores.length) : null, readiness: counts, predictions: store.predictions.length, pendingVerification: store.assessments.filter(row => row.verificationStatus === 'pending').length, recent: store.assessments.slice().sort((a, b) => b.updated.localeCompare(a.updated)).slice(0, 8) });
});

app.get('/api/admin/:section', (req, res, next) => {
  const section = req.params.section;
  if (!validSections.includes(section)) return next();
  if (section === 'dashboard') return res.redirect(307, '/api/admin/dashboard');
  if (section === 'farmers') return res.json(store.farmers.slice().sort((a, b) => a.name.localeCompare(b.name)));
  if (section === 'farms') return res.json(store.assessments.map(row => ({ id: row.id, email: row.email, name: row.name, village: row.village, district: row.district, state: row.state, area: row.area, land: row.land, crops: row.crops, boundaryPoints: row.boundary.length, updated: row.updated })));
  if (section === 'assessments') return res.json(store.assessments.slice().sort((a, b) => b.updated.localeCompare(a.updated)));
  if (section === 'predictions') return res.json(store.predictions);
  if (section === 'documents') return res.json(store.assessments.map(row => ({ id: row.id, email: row.email, name: row.name, village: row.village, items: row.documents, verificationStatus: row.verificationStatus, updated: row.updated })).filter(row => row.items.length));
  if (section === 'verification') return res.json(store.assessments.filter(row => row.result).slice().sort((a, b) => a.verificationStatus.localeCompare(b.verificationStatus) || b.updated.localeCompare(a.updated)));
  if (section === 'model-performance') return res.json({ modelName: 'HumusIQ readiness rules', mode: 'Prototype only', predictionCount: store.predictions.length, assessmentCount: store.assessments.filter(row => row.result).length, accuracy: null, explanation: 'No trained model or verified outcome dataset is connected, so accuracy is not calculated.' });
  if (section === 'reports') return res.json({ generatedAt: new Date().toISOString(), farmerCount: store.farmers.length, farmCount: store.assessments.length, assessmentCount: store.assessments.filter(row => row.result).length, predictionCount: store.predictions.length, assessments: store.assessments });
  if (section === 'settings') return res.json(store.settings);
  next();
});

app.patch('/api/admin/verification/:id', (req, res) => {
  const row = store.assessments.find(item => item.id === req.params.id);
  const status = cleanText(req.body && req.body.status, 30);
  if (!row) return res.status(404).json({ error: 'Assessment not found.' });
  if (!['pending', 'approved', 'needs-info', 'rejected'].includes(status)) return res.status(400).json({ error: 'Invalid verification status.' });
  row.verificationStatus = status;
  row.verificationNote = cleanText(req.body && req.body.note, 1000);
  row.verifiedAt = new Date().toISOString();
  persist();
  res.json(row);
});

app.patch('/api/admin/settings', (req, res) => {
  const body = req.body || {};
  if (['en', 'hi'].includes(body.language)) store.settings.language = body.language;
  if (typeof body.voiceEnabled === 'boolean') store.settings.voiceEnabled = body.voiceEnabled;
  const weights = body.readinessWeights;
  if (weights && typeof weights === 'object') {
    const keys = ['practices', 'land', 'documents', 'soil', 'irrigation', 'inputs'];
    const values = Object.fromEntries(keys.map(key => [key, Number(weights[key])]));
    if (keys.every(key => Number.isFinite(values[key]) && values[key] >= 0 && values[key] <= 100) && Object.values(values).reduce((a, b) => a + b, 0) === 100) store.settings.readinessWeights = values;
  }
  persist();
  res.json(store.settings);
});

app.use('/api', (req, res) => res.status(404).json({ error: 'API route not found.' }));
app.get(['/', '/index.html'], (req, res) => res.sendFile(path.join(webRoot, 'index.html')));
app.get(/^\/admin(?:\/.*)?$/, (req, res) => res.sendFile(path.join(webRoot, 'index.html')));
const publicFiles = { '/styles.css': 'styles.css', '/app.js': 'app.js', '/crop-api.js': 'crop-api.js', '/farmer-hero.png': 'farmer-hero.png' };
app.get(Object.keys(publicFiles), (req, res) => res.sendFile(path.join(webRoot, publicFiles[req.path])));
app.use((req, res) => res.status(404).json({ error: 'Page not found.' }));
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  const code = err.status || 500;
  res.status(code).json({ error: code >= 500 ? 'The server could not complete that request.' : err.message });
});

app.listen(port, () => process.stdout.write('HumusIQ running at http://localhost:' + port + '\n'));
