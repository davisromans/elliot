const express = require('express');
const fs = require('fs');
const path = require('path');
const xauusdController = require('./controller/xauusd');

const app = express();
const port = 3000; // Ensure matches your EA

// --------------------------------------------------
// RAW DELIMITED STRING PARSER MIDDLEWARE (CRITICAL FIX)
// - Accepts raw buffer, converts to UTF-8 string
// - Parses pipe-delimited string into a standard JSON object
// --------------------------------------------------
app.use((req, res, next) => {
  // Only process POST to /signal (or accept all and pass-through)
  if (req.method === 'POST' && req.url === '/signal') {
    let data = [];
    req.on('data', chunk => data.push(chunk));
    req.on('end', () => {
      try {
        const buffer = Buffer.concat(data);
        console.log(`\n📩 Received raw POST (${buffer.length} bytes)`);

        // Convert and trim: Node.js now expects text/plain from MT5
        let rawString = buffer.toString('utf8').trim();
        
        // Log the raw string for debugging
        console.log('Raw Data String:', rawString.slice(0, 512));
        
        // Check for the delimiter '|' and split
        const dataArray = rawString.split('|');

        // Expected format: symbol|timeframe_int|ask|bid|trend|rsi_M5|rsi_M15|atr_M5 (8 fields)
        if (dataArray.length === 8) {
          const [symbol, tf_int, ask, bid, trend_M5, rsi_M5, rsi_M15, atr_M5] = dataArray;
          
          // Create a clean object with types converted
          req.body = {
            symbol: symbol,
            timeframe: `M${tf_int}`, // Convert '5' to 'M5'
            ask: parseFloat(ask),
            bid: parseFloat(bid),
            trend_M5: trend_M5,
            rsi_M5: parseFloat(rsi_M5),
            rsi_M15: parseFloat(rsi_M15),
            atr_M5: parseFloat(atr_M5)
          };
          console.log('✅ Successfully parsed delimited string.');
        } else {
          console.error(`❌ Delimited string failure: Expected 8 fields, got ${dataArray.length}.`);
          req.body = null;
        }

        // Continue to next handler
        next();
      } catch (err) {
        console.error('❌ Error parsing raw body:', err);
        req.body = null;
        next();
      }
    });

    req.on('error', (err) => {
      console.error('❌ Request error:', err);
      next();
    });
  } else {
    // Non-POST or non-/signal: skip raw handling
    next();
  }
});

// Simple logger for debug
app.use((req, res, next) => {
  console.log(`\n--> ${new Date().toISOString()} ${req.method} ${req.url}`);
  console.log('Content-Type header:', req.headers['content-type']);
  if (req.method === 'POST') {
    console.log('Parsed payload (if any):', req.body);
  }
  next();
});

// Route: /signal
app.post('/signal', (req, res, next) => {
  // This is the check that was failing before because req.body was null
  if (!req.body || Object.keys(req.body).length === 0) {
    console.error('❌ Empty or invalid delimited data received');
    return res.status(400).json({ action: 'NONE', comment: 'Invalid data format from MT5' });
  }
  return xauusdController.getSignal(req, res);
});

// Basic health-check
app.get('/', (req, res) => {
  res.send('🟢 MT5 ↔ Node.js Bridge is active');
});

// Start server
app.listen(port, () => {
  console.log(`\n======================================================`);
  console.log(`🟢 Node.js Bridge Server running on port ${port}`);
  console.log(`🟢 MT5 Expert should connect to: http://127.0.0.1:${port}/signal`);
  console.log(`======================================================\n`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🔴 Shutting down Node.js Bridge Server...');
  process.exit();
});