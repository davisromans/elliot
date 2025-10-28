// davisromans/elliot/elliot-ebaf31d54fc9a20660e4e3c0550b11637cf4d6e6/index.js

const express = require('express');
const xauusdController = require('./controller/xauusd'); // Adjust path as needed
const bodyParser = require('body-parser');

const app = express();
const port = 3000; // 🚨 IMPORTANT: This port MUST match the ServerURL in your MQL5 file (127.0.0.1:3000)

// Middleware to parse incoming request body
// Use urlencoded for form-data sent by MQL5's WebRequest
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// 🚨 API Endpoint for the MT5 Bridge 🚨
app.post('/signal', xauusdController.getSignal);

// Start the server
app.listen(port, () => {
    console.log(`\n======================================================`);
    console.log(`🟢 Node.js Bridge Server is running on port ${port}`);
    console.log(`🟢 MT5 will poll the '/signal' endpoint every few seconds.`);
    console.log(`======================================================`);
});

// Graceful exit handler (optional but recommended)
process.on('SIGINT', () => {
    console.log('\n🔴 Shutting down Node.js Bridge Server...');
    process.exit();
});