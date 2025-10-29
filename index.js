// index.js
const express = require('express');
const fs = require('fs');
const path = require('path');
const xauusdController = require('./controller/xauusd');

const app = express();
const port = 3000; // Ensure matches your EA

// --------------------------------------------------
// Raw body middleware for robust JSON parsing
// - Accepts raw buffer, converts to UTF-8 string
// - Trims leading/trailing whitespace and non-printable junk
// - Attempts JSON.parse; if it fails, tries to recover by
//   finding the last '}' and parsing up to there.
// --------------------------------------------------
app.use((req, res, next) => {
  // Only process POST to /signal (or accept all and pass-through)
  if (req.method === 'POST') {
    let data = [];
    req.on('data', chunk => data.push(chunk));
    req.on('end', () => {
      try {
        const buffer = Buffer.concat(data);
        // Log the raw bytes length for debugging
        console.log(`\n📩 Received raw POST (${buffer.length} bytes)`);

        // Convert to string assuming UTF-8 (MT5 uses CP_UTF8 when we set that)
        let text = buffer.toString('utf8');

        // Quick heuristic logging (show first 512 chars)
        console.log('Raw start:', text.slice(0, 512));

        // Trim BOM if present
        if (text.charCodeAt(0) === 0xFEFF) {
          text = text.slice(1);
          console.log('⚙️ Trimmed BOM (UTF-8 BOM detected)');
        }

        // Trim leading/trailing whitespace
        text = text.trim();

        // If the string contains additional chars after the last '}', try to salvage
        // e.g. MT5 sometimes includes trailing null bytes — remove trailing nulls and other non-printable chars.
        // Find last closing brace '}' and cut anything after it.
        const lastBrace = text.lastIndexOf('}');
        if (lastBrace >= 0 && lastBrace !== text.length - 1) {
          const suffix = text.slice(lastBrace + 1).replace(/\s/g, '');
          // If suffix contains printable characters, log it; otherwise treat as benign and trim.
          if (suffix.length > 0) {
            console.log('⚠️ Non-whitespace characters after JSON closing brace:', suffix.slice(0, 200));
          }
          text = text.slice(0, lastBrace + 1);
        }

        // Also strip any trailing null (\u0000) characters
        text = text.replace(/\u0000+$/g, '');

        // Attach sanitized string for later handlers
        req.rawBody = text;

        // Try parsing now
        try {
          req.body = JSON.parse(text);
        } catch (parseErr) {
          // Detailed fallback: try to locate JSON object start and last '}', then parse that substring
          console.warn('⚠️ JSON.parse failed on raw body. Attempting recovery...', parseErr.message);
          const firstBrace = text.indexOf('{');
          const lastBrace2 = text.lastIndexOf('}');
          if (firstBrace >= 0 && lastBrace2 > firstBrace) {
            const candidate = text.substring(firstBrace, lastBrace2 + 1);
            try {
              req.body = JSON.parse(candidate);
              req.rawBody = candidate;
              console.log('✅ Recovered JSON by slicing from first "{" to last "}"');
            } catch (e2) {
              console.error('❌ Recovery parse failed:', e2.message);
              req.body = null;
            }
          } else {
            req.body = null;
          }
        }

        // Continue to next handler
        next();
      } catch (err) {
        console.error('❌ Error reading body:', err);
        // proceed but set body null
        req.body = null;
        next();
      }
    });

    req.on('error', (err) => {
      console.error('❌ Request error:', err);
      next();
    });
  } else {
    // Non-POST: skip raw handling
    next();
  }
});

// Simple logger for debug
app.use((req, res, next) => {
  console.log(`\n--> ${new Date().toISOString()} ${req.method} ${req.url}`);
  console.log('Content-Type header:', req.headers['content-type']);
  if (req.method === 'POST') {
    console.log('Parsed body (if any):', req.body);
    // If body is null but rawBody exists, log snippet
    if (!req.body && req.rawBody) {
      console.log('Sanitized raw body (first 400 chars):', req.rawBody.slice(0, 400));
    }
  }
  next();
});

// Route: /signal
app.post('/signal', (req, res, next) => {
  if (!req.body || Object.keys(req.body).length === 0) {
    console.error('❌ Empty or invalid JSON body received');
    // Return useful diagnostic to MT5
    return res.status(400).json({ error: 'Invalid or empty JSON body', raw: (req.rawBody || '').slice(0, 1000) });
  }
  // Pass along to controller (controller expects req.body)
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
