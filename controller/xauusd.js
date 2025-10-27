const express = require('express');
const app = express();
const port = 3000; 

// Parameters from your BEST optimized property (used for signal generation)
const OPTIMIZED_PARAMS = {
    SYMBOL: "XAUUSD",
    TIMEFRAME: "PERIOD_M5", 
    CONFIRM_RSI_PERIOD: 15,
    RSI_ENTRY_THRESHOLD: 70.16, // High threshold for a SELL signal (overbought)
    EW_WAVE5_RATIO: 0.618,
    SL_ATR_MULTIPLIER: 1.6,
    // Note: MT5 will handle SL/TP calculation, but we pass the ratios/multipliers
};

// Fixed Lot Size for this example. In a real bot, this would be calculated by Risk Manager.
const FIXED_LOT_SIZE = 0.01; 

// --- Express Setup ---
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const log = (message) => {
    console.log(`[${new Date().toLocaleTimeString()}] ${message}`);
};

// --- SIGNAL GENERATION LOGIC ---

/**
 * Generates a simple mock signal based on the RSI threshold.
 * NOTE: This is a placeholder for your full logic which would require live data integration.
 * For this bridge, we only check if the current market is the one we optimized for.
 */
const generateSignal = (currentSymbol, currentTf, currentRSI, currentATR, currentPrice) => {
    // 1. Basic filter: Ensure we are on the correct symbol/timeframe
    if (currentSymbol !== OPTIMIZED_PARAMS.SYMBOL || currentTf !== OPTIMIZED_PARAMS.TIMEFRAME) {
        return { action: 'NONE', comment: `Wrong chart (${currentSymbol} ${currentTf})` };
    }

    // 2. Decide on action based on RSI threshold (This is a simplified check)
    let action = 'NONE';
    let comment = 'RSI Filter Not Met';

    // The threshold is high (70.16), suggesting we only optimized for short signals.
    if (currentRSI >= OPTIMIZED_PARAMS.RSI_ENTRY_THRESHOLD) {
        action = 'SELL'; // RSI Overbought -> SELL Signal
        comment = 'Optimized RSI Overbought';
    } 
    // If you had a low threshold (e.g., 29.84), you would check for BUY signals:
    // else if (currentRSI <= OPTIMIZED_PARAMS.RSI_ENTRY_THRESHOLD_OVERSOLD) {
    //     action = 'BUY'; 
    //     comment = 'Optimized RSI Oversold';
    // }

    if (action === 'NONE') {
        return { action, comment };
    }

    // 3. Calculate SL/TP in POINTS based on ATR
    // The ATR value from MT5 is typically in points for XAUUSD (e.g., 200 points = $2.00)
    const sl_points = Math.round(currentATR * OPTIMIZED_PARAMS.SL_ATR_MULTIPLIER);
    const tp_points = Math.round(sl_points * OPTIMIZED_PARAMS.EW_WAVE5_RATIO);
    
    return {
        action: action,
        lots: FIXED_LOT_SIZE,
        sl_points: sl_points, 
        tp_points: tp_points, 
        comment: `Opt. ${action} | SL:${sl_points} TP:${tp_points}`
    };
};

// --- HTTP ENDPOINT ---
app.post('/getsignal', (req, res) => {
    // Data received from the MQL5 EA's WebRequest (Must match the data MQL5 sends)
    const { symbol, timeframe, rsi_value, atr_value, price } = req.body;
    
    // Convert incoming string data to numbers
    const rsi = parseFloat(rsi_value);
    const atr = parseFloat(atr_value);
    const currentPrice = parseFloat(price);

    if (isNaN(rsi) || isNaN(atr)) {
        log(`Error: Invalid numerical data received (RSI: ${rsi_value}, ATR: ${atr_value})`);
        return res.status(400).json({ action: 'NONE', comment: 'Invalid Data' });
    }

    // Check if there's an open position for this symbol (optional - prevents double entry)
    // NOTE: For true state management, this logic should check MT5 positions via another API call.
    // For now, we assume MT5 handles position management.

    const signal = generateSignal(symbol, timeframe, rsi, atr, currentPrice);

    if (signal.action !== 'NONE') {
        log(`Signal: ${signal.action} ${symbol} | RSI: ${rsi.toFixed(2)} | ATR: ${atr} | SL/TP: ${signal.sl_points}/${signal.tp_points}`);
    } else {
        log(`NONE | RSI: ${rsi.toFixed(2)}`);
    }

    // Send the JSON signal back to MQL5
    res.json(signal);
});

// --- Server Start ---
app.listen(port, () => {
    log(`🟢 MT5 Bridge Server started on port ${port}.`);
    log(`Symbol: ${OPTIMIZED_PARAMS.SYMBOL}, TF: ${OPTIMIZED_PARAMS.TIMEFRAME}`);
});