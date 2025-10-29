// controller/xauusd.js
'use strict';

/**
 * xauusdController
 * Robust: accepts sanitized req.body set by index.js middleware
 * Exports getSignal and helper functions
 */

const xauusdController = {
  // Strategy parameters (tweak as needed)
  TOP_RSI_THRESHOLD: 70.16,
  TOP_ATR_MULTIPLIER: 1.6,
  RISK_PERCENT: 1.5, // 1.5% per trade

  // Main route handler
  getSignal: async (req, res) => {
    // Use req.body from the middleware (already parsed or null)
    const payload = req.body;

    try {
      // Defensive checks
      if (!payload) {
        console.error('❌ No payload (null) after sanitization');
        return res.status(400).json({ action: 'NONE', comment: 'Empty payload' });
      }

      const {
        symbol = '',
        timeframe = '',
        balance = 0,
        equity = 0,
        ask = 0,
        bid = 0,
        trend_M5 = '',
        rsi_M5 = null,
        rsi_M15 = null,
        atr_M5 = null
      } = payload;

      console.log(`[${new Date().toISOString()}] MT5 Request: ${symbol}/${timeframe} | Trend: ${trend_M5} | rsi_M5: ${rsi_M5} | rsi_M15: ${rsi_M15} | atr: ${atr_M5}`);

      // Validate minimal fields
      if (!symbol || (!ask && !bid) || rsi_M5 === null || atr_M5 === null) {
        console.warn('⚠️ Incomplete payload received:', {
          symbol, ask, bid, rsi_M5, rsi_M15, atr_M5
        });
        return res.status(400).json({ action: 'NONE', comment: 'Incomplete payload' });
      }

      // Generate trading signal
      const signal = xauusdController.generateTradingSignal(
        String(trend_M5).toLowerCase(),
        parseFloat(rsi_M5),
        parseFloat(rsi_M15 || rsi_M5),
        parseFloat(atr_M5),
        parseFloat(ask),
        parseFloat(bid)
      );

      // Prepare response
      let response_json;
      if (signal.action === 'DEAL') {
        // Calculate position size
        const positionSize = xauusdController.calculatePositionSize(
          parseFloat(balance || equity || 0),
          signal.entry,
          signal.stopLoss,
          xauusdController.RISK_PERCENT
        );

        response_json = {
          action: 'DEAL',
          type: signal.direction,
          // Ensure volume is a number string or number as your EA expects
          volume: Number(positionSize.lotSize.toFixed(2)),
          sl: Number(signal.stopLoss.toFixed(4)),
          tp: Number(signal.takeProfit.toFixed(4)),
          comment: signal.reason
        };

        console.log('🎯 TRADE SIGNAL ->', response_json);
      } else {
        response_json = {
          action: 'NONE',
          comment: signal.reason
        };
        console.log('ℹ️ No trade:', response_json.comment);
      }

      // Respond to MT5
      return res.json(response_json);

    } catch (err) {
      console.error('❌ Error in getSignal:', err && err.stack ? err.stack : err);
      return res.status(500).json({ action: 'NONE', comment: 'Server error: ' + (err.message || String(err)) });
    }
  },

  // ==================== TRADING SIGNAL GENERATION ====================
  generateTradingSignal: (trend, rsiM5, rsiM15, atrM5, ask, bid) => {
    // Normalize trend string to 'bullish' or 'bearish'
    const t = String(trend || '').toLowerCase();
    const isBullish = t === 'bullish' || t === 'up' || t === 'uptrend';
    const isBearish = t === 'bearish' || t === 'down' || t === 'downtrend';

    const entryPrice = isBullish ? parseFloat(ask) : parseFloat(bid);
    let action = 'NONE';
    let direction = '';
    let reason = 'No signal generated based on parameters.';

    // -- BUY logic
    if (isBullish && rsiM5 < 30 && rsiM15 < xauusdController.TOP_RSI_THRESHOLD) {
      action = 'DEAL';
      direction = 'BUY';
      reason = `BULLISH ENTRY: M5 RSI (${Number(rsiM5).toFixed(2)}) < 30 & M15 (${Number(rsiM15).toFixed(2)}) < ${xauusdController.TOP_RSI_THRESHOLD}`;
    }
    // -- SELL logic
    else if (isBearish && rsiM5 > 70 && rsiM15 > xauusdController.TOP_RSI_THRESHOLD) {
      action = 'DEAL';
      direction = 'SELL';
      reason = `BEARISH ENTRY: M5 RSI (${Number(rsiM5).toFixed(2)}) > 70 & M15 (${Number(rsiM15).toFixed(2)}) > ${xauusdController.TOP_RSI_THRESHOLD}`;
    }

    if (action === 'DEAL') {
      const sl = (direction === 'BUY')
        ? entryPrice - atrM5 * xauusdController.TOP_ATR_MULTIPLIER
        : entryPrice + atrM5 * xauusdController.TOP_ATR_MULTIPLIER;

      const riskDistance = Math.abs(entryPrice - sl);
      const tp = (direction === 'BUY') ? entryPrice + (riskDistance * 2) : entryPrice - (riskDistance * 2);

      // Guard against NaN
      if (!isFinite(sl) || !isFinite(tp) || riskDistance <= 0) {
        throw new Error('Invalid price math for SL/TP');
      }

      return {
        action,
        direction,
        entry: entryPrice,
        stopLoss: sl,
        takeProfit: tp,
        reason
      };
    }

    return { action, reason };
  },

  // Position sizing (simple, approximate for XAU)
  calculatePositionSize: (balance, entry, stopLoss, riskPercent) => {
    const bal = Number(balance || 0);
    const riskPct = Number(riskPercent || xauusdController.RISK_PERCENT);
    const riskAmount = bal * (riskPct / 100);

    const stopDistance = Math.abs(entry - stopLoss);
    // if stopDistance is tiny or zero, fallback to a minimal lot
    if (!isFinite(stopDistance) || stopDistance <= 0) {
      return { lotSize: 0.01, riskAmount, riskPercent: riskPct };
    }

    // Approximate XAU: lots * stopDistance * 100 ~= value at risk (rough heuristic)
    let lotSize = riskAmount / (stopDistance * 100);
    lotSize = Math.max(0.01, Math.min(0.1, lotSize));

    return { lotSize: Number(lotSize.toFixed(2)), riskAmount, riskPercent: riskPct };
  }
};

module.exports = xauusdController;
