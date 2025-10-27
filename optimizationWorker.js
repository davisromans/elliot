
const { parentPort, workerData } = require('worker_threads');

// Import constants and functions from workerData
const { chartKey, chartData, propCount, initialProps } = workerData;
const { 
    INITIAL_BALANCE, MAX_COLLECTIVE_RISK, MIN_LOT_SIZE, 
    DOLLAR_PER_PIP_PER_LOT, AVERAGE_SPREAD_PIPS, 
    COMMISSION_PER_LOT_USD, TIMEFRAMES, PROPERTIES_PER_CHART 
} = workerData.constants;


// --- WORKER UTILITY FUNCTIONS ---

function generateRandomProperty(instrument, timeframe) {
    const fibRatios = [0.382, 0.500, 0.618, 0.786, 1.000, 1.272, 1.618, 2.618];
    const validMtfPeriods = TIMEFRAMES.filter(t => t >= timeframe);
    const mtfPeriod = validMtfPeriods.length > 0 ? validMtfPeriods[Math.floor(Math.random() * validMtfPeriods.length)] : timeframe;
    const rsiPeriod = Math.floor(Math.random() * (21 - 7 + 1)) + 7;
    const rsiOverbought = parseFloat((Math.random() * (85.0 - 70.0) + 70.0).toFixed(2));
    const rsiOversold = parseFloat((Math.random() * (30.0 - 15.0) + 15.0).toFixed(2));
    const stopLossAtrMultiplier = parseFloat((Math.random() * (3.5 - 1.5) + 1.5).toFixed(1));
    
    return {
        instrument,
        timeframe_min: timeframe,
        ew_wave5_target_ratio: fibRatios[Math.floor(Math.random() * fibRatios.length)],
        ew_wave4_pullback_limit: [0.382, 0.5, 0.618][Math.floor(Math.random() * 3)],
        mtf_confirm_period_min: mtfPeriod,
        confirm_rsi_period: rsiPeriod,
        confirm_rsi_entry_threshold: Math.random() < 0.5 ? rsiOverbought : rsiOversold,
        sl_atr_multiplier: stopLossAtrMultiplier, 
    };
}

function calculateRsi(bars, period) {
    let rsiValues = [];
    
    for (let i = 1; i < bars.length; i++) {
        if (i <= period) { rsiValues.push(50); continue; }
        
        let avgGain = 0;
        let avgLoss = 0;
        
        for (let j = i - period + 1; j <= i; j++) {
            const change = bars[j].close - bars[j - 1].close; 
            if (change > 0) {
                avgGain += change;
            } else {
                avgLoss += Math.abs(change);
            }
        }
        
        avgGain /= period;
        avgLoss /= period;
        
        const rs = avgLoss === 0 ? 200 : avgGain / avgLoss; 
        const rsi = 100 - (100 / (1 + rs));
        rsiValues.push(rsi);
    }
    
    while(rsiValues.length < bars.length){ rsiValues.unshift(50); }
    return rsiValues;
}

function run_backtest_on_data(prop, data) {
    const bars = data.bars;
    const pipsPerPriceUnit = data.pipsPerPriceUnit;
    
    if (!bars || bars.length < prop.confirm_rsi_period + 1) {
        return { coreScore: -99999, maxDrawdownPercent: 0, totalTrades: 0, finalBalance: INITIAL_BALANCE, tradeHistory: [] };
    }

    let balance = INITIAL_BALANCE;
    let maxBalance = INITIAL_BALANCE;
    let maxDrawdown = 0; 
    let totalTrades = 0;
    
    let inTrade = false;
    let isLong = false;
    let entryPrice = 0;
    let stopLoss = 0;
    let takeProfit = 0;
    let tradeLots = 0;
    let entryTime = null; 
    
    const tradeHistory = []; 
    
    // Calculate RSI outside the main loop for efficiency
    const rsiValues = calculateRsi(bars, prop.confirm_rsi_period);
    
    // Spread is applied here
    const spread_price_unit = AVERAGE_SPREAD_PIPS / pipsPerPriceUnit; 

    for (let i = 1; i < bars.length; i++) {
        const currentBar = bars[i];
        const prevRsi = rsiValues[i - 1]; 
        const barAtrPips = currentBar.atr; 

        // 1. Check for Trade Exit (SL/TP)
        if (inTrade) {
            let pnl = 0;
            let exitPrice = 0;
            let tradeClosed = false;
            let priceMove = 0;
            let finalPriceForClose = 0;
            let status = '';

            if (isLong) {
                if (currentBar.low <= stopLoss) { exitPrice = stopLoss; tradeClosed = true; status = 'SL'; } 
                else if (currentBar.high >= takeProfit) { exitPrice = takeProfit; tradeClosed = true; status = 'TP'; }
                
                if (tradeClosed) {
                    // Spread is factored in on the exit price for a LONG trade
                    finalPriceForClose = exitPrice - (spread_price_unit / 2.0); 
                    priceMove = finalPriceForClose - entryPrice; 
                }
                
            } else { // Short trade
                if (currentBar.high >= stopLoss) { exitPrice = stopLoss; tradeClosed = true; status = 'SL'; } 
                else if (currentBar.low <= takeProfit) { exitPrice = takeProfit; tradeClosed = true; status = 'TP'; }
                
                if (tradeClosed) {
                    // Spread is factored in on the exit price for a SHORT trade
                    finalPriceForClose = exitPrice + (spread_price_unit / 2.0); 
                    priceMove = entryPrice - finalPriceForClose; 
                }
            }
            
            if (tradeClosed) {
                pnl = priceMove * pipsPerPriceUnit * tradeLots * DOLLAR_PER_PIP_PER_LOT;
                
                // Commission is deducted here (for a round-turn trade)
                const commission_cost = Math.abs(tradeLots) * COMMISSION_PER_LOT_USD;
                pnl -= commission_cost;

                balance += pnl;
                totalTrades++;
                
                tradeHistory.push({ 
                    type: isLong ? 'LONG' : 'SHORT',
                    lots: parseFloat(tradeLots.toFixed(2)),
                    entryTime: entryTime.toISOString(),
                    exitTime: currentBar.time.toISOString(),
                    entryPrice: parseFloat(entryPrice.toFixed(5)),
                    exitPrice: parseFloat(finalPriceForClose.toFixed(5)),
                    pnl: parseFloat(pnl.toFixed(2)),
                    status: status
                });
                
                inTrade = false;
                maxBalance = Math.max(maxBalance, balance);
                if (balance <= 0.01) { balance = 0; break; } 
            }
        }
        
        // 2. Check for Trade Entry 
        if (!inTrade && i >= prop.confirm_rsi_period) {
            const lossPips = prop.sl_atr_multiplier * barAtrPips;
            if (lossPips <= 0) continue; 
            
            const totalRiskUSD = balance * MAX_COLLECTIVE_RISK;
            let totalLotSize = totalRiskUSD / (lossPips * DOLLAR_PER_PIP_PER_LOT);
            tradeLots = Math.max(Math.min(totalLotSize, 5.0), MIN_LOT_SIZE); 
            
            let signal = null;

            if (prevRsi < prop.confirm_rsi_entry_threshold && prop.confirm_rsi_entry_threshold < 50) {
                signal = 'LONG';
            } 
            else if (prevRsi > prop.confirm_rsi_entry_threshold && prop.confirm_rsi_entry_threshold > 50) {
                signal = 'SHORT';
            }
            
            if(signal && tradeLots >= MIN_LOT_SIZE) { 
                inTrade = true;
                entryTime = currentBar.time; 
                
                // Entry price adjusted by half the spread for a LONG trade
                if (signal === 'LONG') {
                    entryPrice = currentBar.open + (spread_price_unit / 2.0); 
                    isLong = true;
                    stopLoss = entryPrice - (lossPips / pipsPerPriceUnit); 
                    takeProfit = entryPrice + (lossPips * prop.ew_wave5_target_ratio / pipsPerPriceUnit);
                // Entry price adjusted by half the spread for a SHORT trade
                } else { // SHORT
                    entryPrice = currentBar.open - (spread_price_unit / 2.0); 
                    isLong = false;
                    stopLoss = entryPrice + (lossPips / pipsPerPriceUnit); 
                    takeProfit = entryPrice - (lossPips * prop.ew_wave5_target_ratio / pipsPerPriceUnit);
                }
            }
        }
    }
    
    // Finalize metrics
    const netProfit = balance - INITIAL_BALANCE;
    const finalScore = (netProfit * 0.5) + (totalTrades * 10); // Current Optimization Score

    return {
        coreScore: parseFloat(finalScore.toFixed(2)),
        finalBalance: parseFloat(balance.toFixed(2)),
        maxDrawdownPercent: 0, 
        totalTrades: totalTrades,
        tradeHistory: tradeHistory 
    };
}


// --- MAIN WORKER EXECUTION ---
const [instrument, timeframe] = chartKey.split('-');
const results = [];

for (let i = 0; i < propCount; i++) {
    const prop = generateRandomProperty(instrument, parseInt(timeframe.replace('min', '')));
    const backtestMetrics = run_backtest_on_data(prop, chartData); 
    
    prop["simulated_final_balance"] = backtestMetrics.finalBalance;
    prop["simulated_total_trades"] = backtestMetrics.totalTrades;
    prop["optimization_score"] = backtestMetrics.coreScore; 

    // Send back minimal data to save on memory transfer
    results.push({ ...prop, tradeHistory: backtestMetrics.tradeHistory }); 
}

// Send results back to the main thread
parentPort.postMessage({ chartKey, results });

// End of workerScriptContent
