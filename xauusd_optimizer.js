const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { Worker, isMainThread, workerData } = require('worker_threads');
const os = require('os'); 

// ==============================================================================
// 1. CONFIGURATION CONSTANTS
// ==============================================================================
const HISTORY_FOLDER = path.join(__dirname, 'history'); 
const CSV_FILES = ['XAUUSDm.csv']; 

const COLUMN_MAP = { DATE_INDEX: 0, TIME_INDEX: 1, BID_INDEX: 2, ASK_INDEX: 3 };
const CSV_DELIMITER = '\t'; 

// SIMULATION & RISK CONSTANTS (Updated for Real-World Simulation)
const INITIAL_BALANCE = 10.0; 
const MAX_COLLECTIVE_RISK = 0.02; // Max 2% risk per trade
const MIN_LOT_SIZE = 0.01;
const DOLLAR_PER_PIP_PER_LOT = 10.0; // XAUUSD Pip Value Multiplier (for calculation)

// 🚨 REAL-WORLD COST FIXES 🚨
const AVERAGE_SPREAD_PIPS = 2.0; // Now: 2.0 pips spread (vs 0.0 before)
const COMMISSION_PER_LOT_USD = 7.0; // Now: $7.00 commission round-turn per lot (vs 0.0 before)
// ----------------------------

// OPTIMIZATION TARGETS
const INSTRUMENTS = ["XAUUSD"]; 
const TIMEFRAMES = [5, 15, 30, 60, 240]; 
const PROPERTIES_PER_CHART = 10000; 
const MAX_BARS_PER_CHART = 10000; 

const OPTIMIZATION_RESULTS_FILE = path.join(__dirname, "top_elliott_parameters_XAUUSD.json"); 
const TRADE_HISTORY_CSV = path.join(__dirname, "best_strategy_trade_history.csv");
const TRADE_PERFORMANCE_HTML = path.join(__dirname, "trade_performance_report.html");
const WORKER_SCRIPT_FILE = path.join(__dirname, "optimizationWorker.js");

const NUM_CORES = os.cpus().length;
const TOTAL_RUNS = INSTRUMENTS.length * TIMEFRAMES.length * PROPERTIES_PER_CHART;
const CHUNKS_PER_CORE = Math.ceil(PROPERTIES_PER_CHART / NUM_CORES); 

// ==============================================================================
// 2. DATA LOADING & PREPARATION (Unchanged for brevity)
// ==============================================================================

async function readCsvFileStream(filePath) {
    const ticks = [];
    const delimiter = CSV_DELIMITER;
    // ... (rest of the function is unchanged)
    
    try {
        if (!fs.existsSync(filePath)) {
            console.error(`\n❌ ERROR: Data file not found at ${filePath}. Make sure it is in the 'history' folder.`);
            return ticks;
        }

        const fileStream = fs.createReadStream(filePath, { encoding: 'utf8' });
        const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

        for await (const line of rl) {
            if (line.includes('Date') || line.includes('<DATE>') || line.trim() === '') continue;
            
            const cols = line.split(delimiter).filter(c => c.trim().length > 0);
            if (cols.length < 4) continue; 

            const bidStr = cols[COLUMN_MAP.BID_INDEX].trim().replace(',', '.');
            const askStr = cols[COLUMN_MAP.ASK_INDEX].trim().replace(',', '.');
            
            const bid = parseFloat(bidStr);
            const ask = parseFloat(askStr);
            
            if (!isNaN(bid) && !isNaN(ask) && bid > 0 && ask > 0) {
                 const mid = (bid + ask) / 2;
                 const datePart = cols[COLUMN_MAP.DATE_INDEX].trim().replace(/\./g, '-');
                 const timePart = cols[COLUMN_MAP.TIME_INDEX].trim();
                 
                 const dateString = `${datePart}T${timePart}`;
                 const timestamp = new Date(dateString);
                 
                 if (isNaN(timestamp.getTime())) {
                     continue; 
                 }

                 ticks.push({ timestamp: timestamp, midPrice: mid });
            }

            if (ticks.length > 500000) { rl.close(); break; } 
        }
    } catch (e) {
        console.error(`Error processing file ${filePath}: ${e.message}`);
    }

    return ticks;
}

function tickToBarConversion(symbol, ticks, timeframeMinutes) {
    // ... (rest of the function is unchanged)
    if (ticks.length === 0) return { bars: [], pipsPerPriceUnit: 100 };

    ticks.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

    const pipsPerPriceUnit = 100;
    const barDurationMillis = timeframeMinutes * 60 * 1000;
    
    const bars = [];
    let currentBar = null;
    let currentBarStartTimeMillis = 0; 

    for (const tick of ticks) {
        const tickTime = tick.timestamp.getTime();
        const midPrice = tick.midPrice;
        
        const snappedEpochMillis = Math.floor(tickTime / barDurationMillis) * barDurationMillis;
        const newBarStartTime = new Date(snappedEpochMillis);

        if (currentBar === null || snappedEpochMillis > currentBarStartTimeMillis) {
            
            if (currentBar !== null) {
                const barRange = Math.abs(currentBar.high - currentBar.low);
                currentBar.atr = parseFloat((barRange * pipsPerPriceUnit).toFixed(2)); 
                bars.push(currentBar);
                if (bars.length >= MAX_BARS_PER_CHART) break; 
            }

            currentBarStartTimeMillis = snappedEpochMillis;
            currentBar = {
                open: midPrice,
                high: midPrice,
                low: midPrice,
                close: midPrice,
                time: newBarStartTime,
                atr: 0
            };
            
        } else {
            currentBar.high = Math.max(currentBar.high, midPrice);
            currentBar.low = Math.min(currentBar.low, midPrice);
            currentBar.close = midPrice; 
        }
    }
    
    if (currentBar !== null) {
        const barRange = Math.abs(currentBar.high - currentBar.low);
        currentBar.atr = parseFloat((barRange * pipsPerPriceUnit).toFixed(2));
        bars.push(currentBar);
    }

    return { bars: bars.filter(b => b.atr > 0), pipsPerPriceUnit }; 
}

async function readCsvData() {
    const dataSet = {};
    console.log(`\nAttempting to read data from folder: ${HISTORY_FOLDER}`);

    if (!fs.existsSync(HISTORY_FOLDER)) {
        fs.mkdirSync(HISTORY_FOLDER);
        console.error(`\n❌ ERROR: 'history' folder created. Please place your CSV file inside it.`);
        return dataSet;
    }

    for (const fileName of CSV_FILES) {
        const filePath = path.join(HISTORY_FOLDER, fileName);
        const symbol = fileName.replace('m.csv', '').toUpperCase();
        
        try {
            const ticks = await readCsvFileStream(filePath);
            
            if (ticks.length === 0) {
                console.error(`\n❌ ERROR: Zero valid ticks loaded from ${fileName}. Check file encoding or path.`);
                continue;
            }
            console.log(`✅ Loaded ${ticks.length} valid ticks for ${symbol} using streaming.`);

            TIMEFRAMES.forEach(tf => {
                const chartKey = `${symbol}-${tf}min`;
                const barData = tickToBarConversion(symbol, ticks, tf);
                dataSet[chartKey] = barData; 
                console.log(`   -> Generated ${barData.bars.length} ${tf}m bars for ${symbol} (PPPU: ${barData.pipsPerPriceUnit})`);
            });

        } catch (e) {
            console.error(`\n❌ ERROR: Critical failure during stream processing of ${fileName}. Reason: ${e.message}`);
        }
    }
    return dataSet;
}

// ==============================================================================
// 3. CORE MULTI-PROCESSING OPTIMIZATION LOGIC (Worker Script Update)
// ==============================================================================

/**
 * Generates the content for the worker script file containing the core backtesting logic.
 * This is regenerated on every run to include the latest constants.
 */
function createWorkerScriptFile() {
    const workerScriptContent = `
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
`;
    fs.writeFileSync(WORKER_SCRIPT_FILE, workerScriptContent);
    console.log(`\n✅ Generated worker script: ${WORKER_SCRIPT_FILE}`);
}

/**
 * Orchestrates the multithreaded optimization. (Unchanged for brevity)
 */
function runMultithreadedOptimization(parsedData) {
    return new Promise(async (resolve, reject) => {
        const workers = [];
        let allResults = [];
        let completedJobs = 0;
        let totalJobs = 0;

        for (const instrument of INSTRUMENTS) {
            for (const timeframe of TIMEFRAMES) {
                const chartKey = `${instrument}-${timeframe}min`;
                const chartData = parsedData[chartKey];
                const chartBars = chartData ? chartData.bars : [];

                if (!chartBars || chartBars.length < 50) {
                    console.log(`\n⚠️ Skipping ${chartKey}: Only ${chartBars.length} valid bars found (Need > 50).`);
                    continue;
                }

                // Partition the work into chunks per core
                for (let i = 0; i < NUM_CORES; i++) {
                    const propCount = CHUNKS_PER_CORE;
                    if (propCount > 0) {
                        totalJobs++;
                        const worker = new Worker(WORKER_SCRIPT_FILE, {
                            workerData: {
                                chartKey,
                                chartData,
                                propCount,
                                constants: {
                                    INITIAL_BALANCE, MAX_COLLECTIVE_RISK, MIN_LOT_SIZE, 
                                    DOLLAR_PER_PIP_PER_LOT, AVERAGE_SPREAD_PIPS, 
                                    COMMISSION_PER_LOT_USD, TIMEFRAMES, PROPERTIES_PER_CHART
                                }
                            }
                        });

                        worker.on('message', (msg) => {
                            allResults.push(...msg.results);
                            completedJobs++;

                            // Progress Update (approximated)
                            const overallProgress = (allResults.length / TOTAL_RUNS) * 100;
                            process.stdout.write(`\rOverall Progress: ${overallProgress.toFixed(2)}% | Workers Done: ${completedJobs}/${totalJobs} | Found: ${allResults.length} properties`);

                            if (completedJobs === totalJobs) {
                                workers.forEach(w => w.terminate());
                                resolve(allResults);
                            }
                        });

                        worker.on('error', reject);
                        worker.on('exit', (code) => {
                            if (code !== 0) {
                                console.error(`Worker stopped with exit code ${code}`);
                            }
                        });

                        workers.push(worker);
                    }
                }
            }
        }
        
        if (totalJobs === 0) {
            resolve([]);
        }
    });
}

// ==============================================================================
// 4. REPORTING & UTILITY FUNCTIONS (Unchanged for brevity)
// ==============================================================================

function calculateMetricsAndSaveHistory(results, finalProp, bestChartData) {
    // ... (rest of the function is unchanged)
    const initialBalance = INITIAL_BALANCE;
    let balance = initialBalance;
    let maxBalance = initialBalance;
    let maxDrawdownUSD = 0;
    
    const history = finalProp.tradeHistory.map(trade => {
        const pnl = trade.pnl;
        balance += pnl;
        
        // Drawdown calculation
        maxBalance = Math.max(maxBalance, balance);
        maxDrawdownUSD = Math.max(maxDrawdownUSD, maxBalance - balance);
        
        return { ...trade, runningBalance: balance };
    });
    
    if (history.length === 0) {
        return { metrics: null, tradeHistory: [] };
    }
    
    const totalTrades = history.length;
    const finalBalance = balance;
    const netProfit = finalBalance - initialBalance;
    const profitableTrades = history.filter(t => t.pnl > 0).length;
    const grossProfit = history.filter(t => t.pnl > 0).reduce((sum, t) => sum + t.pnl, 0);
    const grossLoss = history.filter(t => t.pnl < 0).reduce((sum, t) => sum + Math.abs(t.pnl), 0);
    const winRate = (profitableTrades / totalTrades);
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? Infinity : 0);
    const maxDrawdownPercent = maxBalance > 0 ? (maxDrawdownUSD / maxBalance) * 100 : 0;
    
    const minDate = history[0].exitTime.substring(0, 10);
    const maxDate = history[history.length - 1].exitTime.substring(0, 10);

    const metrics = {
        "Initial Balance": `$${initialBalance.toFixed(2)}`,
        "Final Balance": `$${finalBalance.toFixed(2)}`,
        "Net Profit": `$${netProfit.toFixed(2)}`,
        "Total Trades": totalTrades.toString(),
        "Win Rate": `${(winRate * 100).toFixed(2)}%`,
        "Profit Factor": profitFactor.toFixed(2),
        "Gross Profit": `$${grossProfit.toFixed(2)}`,
        "Gross Loss": `$${grossLoss.toFixed(2)}`,
        "Max Drawdown (USD)": `$${maxDrawdownUSD.toFixed(2)}`,
        "Max Drawdown (%)": `${maxDrawdownPercent.toFixed(2)}%`,
        "Date Range": `${minDate} to ${maxDate}`
    };

    // Save CSV
    const headers = ["Status", "Type", "Lots", "Entry Time", "Exit Time", "Entry Price", "Exit Price", "PnL (USD)", "Running Balance"];
    const rows = history.map(trade => [
        trade.status, trade.type, trade.lots, 
        trade.entryTime, trade.exitTime, 
        trade.entryPrice, trade.exitPrice, 
        trade.pnl.toFixed(2), trade.runningBalance.toFixed(2)
    ].join(','));

    fs.writeFileSync(TRADE_HISTORY_CSV, headers.join(',') + '\n' + rows.join('\n'));
    console.log(`\n✅ Trade history saved for best parameter to: ${TRADE_HISTORY_CSV}`);
    
    return { metrics, tradeHistory: history };
}


/**
 * Generates an interactive HTML report with Chart.js. (Unchanged for brevity)
 */
function generateHtmlReport(metrics, history) {
    if (!metrics || history.length === 0) {
        console.log(`\n❌ Skipping HTML generation: No valid trades found.`);
        return;
    }
    
    // Data for Chart.js
    const chartLabels = history.map(t => new Date(t.exitTime).toLocaleString());
    const chartData = history.map(t => t.runningBalance);

    let metricsHtml = '<table>';
    for (const [key, value] of Object.entries(metrics)) {
        metricsHtml += `<tr><td><b>${key}</b></td><td>${value}</td></tr>`;
    }
    metricsHtml += '</table>';

    let tableRowsHtml = '<thead><tr><th>Status</th><th>Type</th><th>Lots</th><th>Exit Time</th><th>Entry Price</th><th>Exit Price</th><th>PnL (USD)</th><th>Running Balance</th></tr></thead><tbody>';
    history.forEach(trade => {
        const statusClass = trade.status === 'TP' ? 'status-TP' : (trade.status === 'SL' ? 'status-SL' : '');
        tableRowsHtml += `<tr>
            <td class="${statusClass}">${trade.status}</td>
            <td>${trade.type}</td>
            <td>${trade.lots.toFixed(2)}</td>
            <td>${new Date(trade.exitTime).toLocaleString()}</td>
            <td>${trade.entryPrice.toFixed(5)}</td>
            <td>${trade.exitPrice.toFixed(5)}</td>
            <td>$${trade.pnl.toFixed(2)}</td>
            <td>$${trade.runningBalance.toFixed(2)}</td>
        </tr>`;
    });
    tableRowsHtml += '</tbody>';


    const htmlContent = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Node.js Super Backtesting Report</title>
        <script src="https://cdn.jsdelivr.net/npm/chart.js@3.7.0/dist/chart.min.js"></script>
        <style>
            body { font-family: Arial, sans-serif; padding: 20px; background-color: #f8f9fa; }
            .container { max-width: 1400px; margin: auto; background: white; padding: 30px; border-radius: 10px; box-shadow: 0 4px 12px rgba(0,0,0,0.15); }
            h1 { color: #007bff; border-bottom: 3px solid #007bff; padding-bottom: 10px; margin-bottom: 20px; }
            h2 { color: #343a40; margin-top: 30px; border-left: 5px solid #ffc107; padding-left: 10px; }
            .grid-container { display: grid; grid-template-columns: 1fr 2fr; gap: 30px; }
            .metrics-table table { width: 100%; border-collapse: collapse; }
            .metrics-table td { padding: 8px; border-bottom: 1px solid #ddd; }
            .metrics-table b { font-weight: bold; color: #000; }
            .trade-table-wrapper { margin-top: 20px; overflow-x: auto; max-height: 500px; }
            .trade-table table { width: 100%; border-collapse: collapse; }
            .trade-table th, .trade-table td { border: 1px solid #ddd; padding: 8px; text-align: left; font-size: 14px; }
            .trade-table th { background-color: #007bff; color: white; position: sticky; top: 0; }
            .status-TP { background-color: #d4edda; color: #155724; }
            .status-SL { background-color: #f8d7da; color: #721c24; }
        </style>
    </head>
    <body>
        <div class="container">
            <h1>XAUUSD Super Backtesting Report 🚀</h1>
            <p>**Optimization Method:** Multi-threaded (MP) search for max trades/profit balance.</p>

            <div class="grid-container">
                <div class="metrics-area">
                    <h2>Key Performance Indicators (KPIs)</h2>
                    <div class="metrics-table">${metricsHtml}</div>
                </div>
                <div class="chart-area">
                    <h2>Equity Curve</h2>
                    <canvas id="equityChart"></canvas>
                </div>
            </div>

            <h2>Detailed Trade History (${history.length} Trades)</h2>
            <div class="trade-table-wrapper">
                <div class="trade-table">
                    <table>${tableRowsHtml}</table>
                </div>
            </div>
            
        </div>
        
        <script>
            const ctx = document.getElementById('equityChart').getContext('2d');
            const labels = ${JSON.stringify(chartLabels)};
            const data = ${JSON.stringify(chartData)};

            new Chart(ctx, {
                type: 'line',
                data: {
                    labels: labels,
                    datasets: [{
                        label: 'Running Equity',
                        data: data,
                        borderColor: 'rgb(75, 192, 192)',
                        tension: 0.1,
                        fill: false,
                        pointRadius: 2
                    }]
                },
                options: {
                    responsive: true,
                    plugins: {
                        legend: { display: true },
                        title: { display: true, text: 'Equity Curve Over Time' }
                    },
                    scales: {
                        x: { display: true, title: { display: true, text: 'Exit Time' } },
                        y: { display: true, title: { display: true, text: 'Balance (USD)' } }
                    }
                }
            });
        </script>
    </body>
    </html>
    `;

    fs.writeFileSync(TRADE_PERFORMANCE_HTML, htmlContent);
    console.log(`\n✅ Interactive HTML Report generated successfully: ${TRADE_PERFORMANCE_HTML}`);
}


// ==============================================================================
// 5. MAIN EXECUTION (Unchanged for brevity)
// ==============================================================================

async function main() {
    createWorkerScriptFile();
    
    const startTime = Date.now();
    const parsedData = await readCsvData();
    
    console.log(`\n--- XAUUSD MULTI-THREADED OPTIMIZATION (Cores: ${NUM_CORES}) ---`);
    console.log(`Total Runs: ${TOTAL_RUNS}`);
    console.log("--- REAL-WORLD COSTS ENABLED (Spread: 2.0 pips, Comm: $7.00/lot) ---");
    console.log("-".repeat(70));
    
    const allResults = await runMultithreadedOptimization(parsedData);
    
    const endTime = Date.now();
    
    // --- Finalize and Save Results ---
    allResults.sort((a, b) => b.optimization_score - a.optimization_score);
    const bestOverall10 = allResults.slice(0, 10);
    const bestPropWithHistory = bestOverall10[0];
    
    process.stdout.write("\r" + " ".repeat(100) + "\r");
    console.log("\n" + "=".repeat(70));
    console.log("Optimization Complete (SUPER BACKTESTING ENGINE).");
    console.log(`Total properties generated: ${allResults.length}`);
    console.log(`Time elapsed: ${(endTime - startTime) / 1000} seconds`);
    console.log("=".repeat(70));
    
    // --- Calculate final metrics and generate reports ---
    if (bestPropWithHistory) {
        const { metrics, tradeHistory } = calculateMetricsAndSaveHistory(allResults, bestPropWithHistory, parsedData);
        generateHtmlReport(metrics, tradeHistory);
    }

    const finalOutput = {
        metadata: {
            description: "Top 10 overall properties from multi-threaded backtest. Initial Balance: $10.00.",
            total_properties_generated: allResults.length,
            time_elapsed_seconds: (endTime - startTime) / 1000,
            output_timestamp: new Date().toISOString()
        },
        top_10_properties: bestOverall10.map(p => {
            // Remove the trade history from the final JSON for cleaner output
            const { tradeHistory, ...rest } = p;
            return rest;
        })
    };

    fs.writeFileSync(OPTIMIZATION_RESULTS_FILE, JSON.stringify(finalOutput, null, 4));
    console.log(`\n✅ Successfully saved ${bestOverall10.length} properties to ${OPTIMIZATION_RESULTS_FILE}`);
}

main().catch(err => {
    console.error("\nCRITICAL ERROR:", err);
    // Attempt to delete the temporary worker file on crash
    if (fs.existsSync(WORKER_SCRIPT_FILE)) {
        fs.unlinkSync(WORKER_SCRIPT_FILE);
    }
});