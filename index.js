// davisromans/elliot/elliot-ebaf31d54fc9a20660e4e3c0550b11637cf4d6e6/index.js

const express = require('express');
const xauusdController = require('./controller/xauusd'); // Adjust path if needed

const app = express();
const port = 3000; // 🚨 Must match ServerURL in your MQL5 EA

// ======================================================
// 🧩 MIDDLEWARE — handle incoming JSON payloads
// ======================================================

// Handles JSON sent from MQL5 (application/json)
app.use(express.json({ limit: '50mb' }));

// Handles fallback form-data (in case MQL5 sends x-www-form-urlencoded)
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Log each incoming request (optional but helps debugging)
app.use((req, res, next) => {
    console.log(`\n📩 Incoming ${req.method} ${req.url}`);
    console.log('Headers:', req.headers['content-type']);
    console.log('Body:', req.body);
    next();
});

// ======================================================
// 🧠 ROUTES
// ======================================================

// Endpoint for MT5 bridge
app.post('/signal', (req, res, next) => {
    if (!req.body || Object.keys(req.body).length === 0) {
        console.error('❌ Empty or invalid body received');
        return res.status(400).json({ error: 'Invalid or empty body' });
    }
    next();
}, xauusdController.getSignal);

// Health check (optional)
app.get('/', (req, res) => {
    res.send('🟢 MT5 ↔ Node.js Bridge is active');
});

// ======================================================
// 🚀 START SERVER
// ======================================================

app.listen(port, () => {
    console.log(`\n======================================================`);
    console.log(`🟢 Node.js Bridge Server running on port ${port}`);
    console.log(`🟢 MT5 Expert should connect to: http://127.0.0.1:${port}/signal`);
    console.log(`======================================================\n`);
});

// ======================================================
// 🧱 GRACEFUL SHUTDOWN
// ======================================================
process.on('SIGINT', () => {
    console.log('\n🔴 Shutting down Node.js Bridge Server...');
    process.exit();
});
