const xauusdController = {
    getSignal: async (req, res) => {
        console.log('working');
        const { symbol, timeframe, balance, equity, ask, bid, technical_data } = req.body; 
        
        console.log(`[${new Date().toISOString()}] MT5 Request: ${symbol}/${timeframe}. Balance: $${balance}. Live Ask: ${ask}, Live Bid: ${bid}`);

        // Parse the comprehensive technical data with better error handling
        let technical;
        try {
            // Log the raw data for debugging
            console.log(`📦 Raw technical data length: ${technical_data ? technical_data.length : 0} characters`);
            
            if (!technical_data) {
                throw new Error('Technical data is empty');
            }
            
            // Clean the JSON string before parsing
            let cleanedData = technical_data
                .replace(/,\s*]/g, ']')  // Remove trailing commas in arrays
                .replace(/,\s*}/g, '}')  // Remove trailing commas in objects
                .replace(/\\/g, '\\\\')  // Escape backslashes
                .replace(/\//g, '\\/')   // Escape forward slashes
                .replace(/\f/g, '\\f')   // Escape form feeds
                .replace(/\n/g, '\\n')   // Escape newlines
                .replace(/\r/g, '\\r')   // Escape carriage returns
                .replace(/\t/g, '\\t');  // Escape tabs
            
            technical = JSON.parse(cleanedData);
            console.log(`📊 Successfully parsed ${technical.candles ? technical.candles.length : 0} candles for analysis`);
        } catch (error) {
            console.error('❌ Failed to parse technical data:', error.message);
            console.error('🔍 First 500 chars of data:', technical_data ? technical_data.substring(0, 500) : 'NULL');
            console.error('🔍 Error position:', error.message.match(/position (\d+)/));
            return res.json({ action: 'NONE', comment: 'Technical data parsing failed: ' + error.message });
        }

        // ==================== REAL TECHNICAL ANALYSIS ====================
        
        try {
            const analysis = performComprehensiveAnalysis(technical);
            
            console.log('🎯 COMPREHENSIVE ANALYSIS RESULTS:');
            console.log(`   - RSI: ${analysis.indicators.rsi}`);
            console.log(`   - MACD: ${analysis.indicators.macd_main} (Signal: ${analysis.indicators.macd_signal})`);
            console.log(`   - Stochastic: ${analysis.indicators.stoch_main}`);
            console.log(`   - Trend: ${analysis.trend.direction} (Strength: ${analysis.trend.strength})`);
            console.log(`   - Elliott Wave: ${analysis.elliott.wave_count} waves detected`);
            console.log(`   - Support: ${analysis.levels.support.toFixed(2)}`);
            console.log(`   - Resistance: ${analysis.levels.resistance.toFixed(2)}`);

            // ==================== ADVANCED TRADING STRATEGY ====================
            
            const signal = generateTradingSignal(analysis, parseFloat(ask), parseFloat(bid));
            
            let response_json;
            
            if (signal.action === 'DEAL') {
                // Calculate position sizing based on risk management
                const positionSize = calculatePositionSize(
                    parseFloat(balance), 
                    signal.entry, 
                    signal.stopLoss, 
                    signal.direction
                );
                
                response_json = {
                    action: 'DEAL',
                    type: signal.direction,
                    volume: positionSize.lotSize,
                    sl: signal.stopLoss.toFixed(2),
                    tp: signal.takeProfit.toFixed(2),
                    comment: signal.reason
                };
                
                console.log(`🎯 TRADE SIGNAL: ${signal.direction}`);
                console.log(`   - Reason: ${signal.reason}`);
                console.log(`   - Confidence: ${signal.confidence}%`);
                console.log(`   - Lot Size: ${positionSize.lotSize}`);
                console.log(`   - Risk: $${positionSize.riskAmount.toFixed(2)} (${positionSize.riskPercent}%)`);
                
            } else if (signal.action === 'CLOSE') {
                response_json = {
                    action: 'CLOSE', 
                    comment: signal.reason
                };
            } else {
                response_json = {
                    action: 'NONE',
                    comment: signal.reason
                };
            }

            console.log(`-> Sending to MT5: ${JSON.stringify(response_json)}`);
            res.json(response_json);
            
        } catch (analysisError) {
            console.error('❌ Analysis failed:', analysisError);
            res.json({ 
                action: 'NONE', 
                comment: 'Analysis failed: ' + analysisError.message 
            });
        }
    }
};

// ... rest of your analysis functions remain the same ...

// ==================== REAL TECHNICAL ANALYSIS FUNCTIONS ====================

function performComprehensiveAnalysis(technical) {
    const candles = technical.candles;
    const indicators = technical.indicators;
    
    // 1. Price Action Analysis
    const priceAction = analyzePriceAction(candles);
    
    // 2. Elliott Wave Analysis
    const elliott = analyzeElliottWaves(candles);
    
    // 3. Indicator Analysis
    const indicatorAnalysis = analyzeIndicators(indicators, candles);
    
    // 4. Support & Resistance
    const levels = calculateSupportResistance(candles);
    
    // 5. Trend Analysis
    const trend = analyzeTrend(candles, indicators);
    
    return {
        priceAction,
        elliott,
        indicators: indicatorAnalysis,
        levels,
        trend,
        market_structure: technical.market_structure
    };
}

function analyzePriceAction(candles) {
    const recent = candles.slice(0, 50);
    const medium = candles.slice(0, 200);
    
    // Calculate swing highs and lows
    const swingHighs = findSwingHighs(candles, 5);
    const swingLows = findSwingLows(candles, 5);
    
    // Calculate volatility
    const volatility = calculateVolatility(candles);
    
    // Identify chart patterns
    const patterns = identifyChartPatterns(candles, swingHighs, swingLows);
    
    return {
        swingHighs: swingHighs.slice(0, 3),
        swingLows: swingLows.slice(0, 3),
        volatility: volatility.current,
        patterns,
        recentHigh: Math.max(...recent.map(c => c.high)),
        recentLow: Math.min(...recent.map(c => c.low))
    };
}

function analyzeElliottWaves(candles) {
    // Simplified Elliott Wave analysis
    const waves = [];
    const prices = candles.map(c => c.close);
    
    // Find impulse waves (5-wave patterns)
    let waveCount = 0;
    let direction = null;
    
    for (let i = 10; i < prices.length - 10; i++) {
        const segment = prices.slice(i - 10, i + 10);
        const trend = analyzeSegmentTrend(segment);
        
        if (trend.strength > 0.7) {
            if (direction !== trend.direction) {
                waveCount++;
                direction = trend.direction;
                waves.push({
                    start: i - 10,
                    end: i + 10,
                    direction: trend.direction,
                    strength: trend.strength
                });
            }
        }
    }
    
    return {
        wave_count: waveCount,
        waves: waves.slice(0, 5),
        current_phase: waveCount > 0 ? waves[0].direction : 'consolidation'
    };
}

function analyzeIndicators(indicators, candles) {
    const currentPrice = candles[0].close;
    
    // RSI Analysis
    const rsiSignal = indicators.rsi < 30 ? 'oversold' : 
                     indicators.rsi > 70 ? 'overbought' : 'neutral';
    
    // MACD Analysis
    const macdSignal = indicators.macd_main > indicators.macd_signal ? 'bullish' : 'bearish';
    const macdHistogram = indicators.macd_main - indicators.macd_signal;
    
    // Stochastic Analysis
    const stochSignal = indicators.stoch_main < 20 ? 'oversold' :
                       indicators.stoch_main > 80 ? 'overbought' : 'neutral';
    
    // Moving Average Analysis
    const maAlignment = analyzeMAAlignment(indicators);
    
    return {
        rsi: indicators.rsi,
        rsi_signal: rsiSignal,
        macd_main: indicators.macd_main,
        macd_signal: indicators.macd_signal,
        macd_histogram: macdHistogram,
        macd_signal: macdSignal,
        stoch_main: indicators.stoch_main,
        stoch_signal: indicators.stoch_signal,
        stoch_signal_type: stochSignal,
        ma_alignment: maAlignment,
        atr: indicators.atr
    };
}

function analyzeTrend(candles, indicators) {
    const prices = candles.map(c => c.close);
    const shortMA = calculateMA(prices, 20);
    const mediumMA = calculateMA(prices, 50);
    const longMA = calculateMA(prices, 200);
    
    const shortTrend = prices[0] > shortMA ? 'bullish' : 'bearish';
    const mediumTrend = prices[0] > mediumMA ? 'bullish' : 'bearish';
    const longTrend = prices[0] > longMA ? 'bullish' : 'bearish';
    
    let direction = 'neutral';
    let strength = 0;
    
    if (shortTrend === 'bullish' && mediumTrend === 'bullish' && longTrend === 'bullish') {
        direction = 'bullish';
        strength = 0.9;
    } else if (shortTrend === 'bearish' && mediumTrend === 'bearish' && longTrend === 'bearish') {
        direction = 'bearish';
        strength = 0.9;
    } else if (shortTrend === mediumTrend) {
        direction = shortTrend;
        strength = 0.7;
    } else {
        direction = 'consolidation';
        strength = 0.3;
    }
    
    return { direction, strength, shortMA, mediumMA, longMA };
}

function calculateSupportResistance(candles) {
    const prices = candles.map(c => c.close);
    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);
    
    // Use recent swing points for S/R
    const recentHigh = Math.max(...highs.slice(0, 50));
    const recentLow = Math.min(...lows.slice(0, 50));
    const pivot = (recentHigh + recentLow + prices[0]) / 3;
    
    return {
        support: pivot - (recentHigh - pivot),
        resistance: pivot + (recentHigh - pivot),
        pivot: pivot,
        recentHigh,
        recentLow
    };
}

// ==================== TRADING SIGNAL GENERATION ====================

function generateTradingSignal(analysis, ask, bid) {
    const { indicators, trend, elliott, levels } = analysis;
    const currentPrice = ask;
    
    let signals = [];
    
    // 1. Elliott Wave Signals
    if (elliott.wave_count >= 3 && elliott.current_phase === 'bullish') {
        signals.push({ type: 'BUY', reason: 'Elliott Wave impulse pattern', confidence: 75 });
    }
    if (elliott.wave_count >= 3 && elliott.current_phase === 'bearish') {
        signals.push({ type: 'SELL', reason: 'Elliott Wave impulse pattern', confidence: 75 });
    }
    
    // 2. RSI + Trend Signals
    if (indicators.rsi_signal === 'oversold' && trend.direction === 'bullish') {
        signals.push({ type: 'BUY', reason: 'RSI oversold in uptrend', confidence: 80 });
    }
    if (indicators.rsi_signal === 'overbought' && trend.direction === 'bearish') {
        signals.push({ type: 'SELL', reason: 'RSI overbought in downtrend', confidence: 80 });
    }
    
    // 3. MACD Crossover Signals
    if (indicators.macd_signal === 'bullish' && indicators.macd_histogram > 0) {
        signals.push({ type: 'BUY', reason: 'MACD bullish crossover', confidence: 70 });
    }
    if (indicators.macd_signal === 'bearish' && indicators.macd_histogram < 0) {
        signals.push({ type: 'SELL', reason: 'MACD bearish crossover', confidence: 70 });
    }
    
    // 4. Support/Resistance Bounce Signals
    if (currentPrice <= levels.support * 1.001) {
        signals.push({ type: 'BUY', reason: 'Bounce from support', confidence: 65 });
    }
    if (currentPrice >= levels.resistance * 0.999) {
        signals.push({ type: 'SELL', reason: 'Rejection from resistance', confidence: 65 });
    }
    
    // Find the highest confidence signal
    if (signals.length > 0) {
        signals.sort((a, b) => b.confidence - a.confidence);
        const bestSignal = signals[0];
        
        // Calculate stop loss and take profit
        const atr = indicators.atr || 1.0;
        const stopLoss = bestSignal.type === 'BUY' ? 
            currentPrice - (atr * 2) : 
            currentPrice + (atr * 2);
            
        const takeProfit = bestSignal.type === 'BUY' ?
            currentPrice + (atr * 3) :
            currentPrice - (atr * 3);
        
        return {
            action: 'DEAL',
            direction: bestSignal.type,
            entry: bestSignal.type === 'BUY' ? ask : bid,
            stopLoss,
            takeProfit,
            reason: bestSignal.reason,
            confidence: bestSignal.confidence
        };
    }
    
    return {
        action: 'NONE',
        reason: 'No high-confidence signals detected'
    };
}

function calculatePositionSize(balance, entry, stopLoss, direction) {
    const riskPercent = 1.5; // Risk 1.5% per trade
    const riskAmount = balance * (riskPercent / 100);
    
    const stopDistance = Math.abs(entry - stopLoss);
    const pointValue = 0.01; // For XAUUSD
    
    // Calculate lot size based on risk
    let lotSize = riskAmount / (stopDistance * 100);
    lotSize = Math.max(0.01, Math.min(0.1, lotSize)); // Limit between 0.01 and 0.1
    
    return {
        lotSize: parseFloat(lotSize.toFixed(2)),
        riskAmount,
        riskPercent
    };
}

// ==================== HELPER FUNCTIONS ====================

function findSwingHighs(candles, lookback) {
    const highs = [];
    for (let i = lookback; i < candles.length - lookback; i++) {
        const currentHigh = candles[i].high;
        let isSwingHigh = true;
        
        for (let j = 1; j <= lookback; j++) {
            if (candles[i - j].high >= currentHigh || candles[i + j].high >= currentHigh) {
                isSwingHigh = false;
                break;
            }
        }
        
        if (isSwingHigh) highs.push({ index: i, price: currentHigh });
    }
    return highs;
}

function findSwingLows(candles, lookback) {
    const lows = [];
    for (let i = lookback; i < candles.length - lookback; i++) {
        const currentLow = candles[i].low;
        let isSwingLow = true;
        
        for (let j = 1; j <= lookback; j++) {
            if (candles[i - j].low <= currentLow || candles[i + j].low <= currentLow) {
                isSwingLow = false;
                break;
            }
        }
        
        if (isSwingLow) lows.push({ index: i, price: currentLow });
    }
    return lows;
}

function calculateVolatility(candles) {
    const changes = [];
    for (let i = 1; i < Math.min(50, candles.length); i++) {
        changes.push(Math.abs(candles[i].close - candles[i-1].close));
    }
    const avgChange = changes.reduce((a, b) => a + b, 0) / changes.length;
    return { current: avgChange, average: avgChange };
}

function analyzeSegmentTrend(prices) {
    const start = prices[0];
    const end = prices[prices.length - 1];
    const change = end - start;
    const strength = Math.abs(change) / start;
    
    return {
        direction: change > 0 ? 'bullish' : 'bearish',
        strength: Math.min(strength * 10, 1) // Normalize to 0-1
    };
}

function analyzeMAAlignment(indicators) {
    const mas = [indicators.ma_fast, indicators.ma_medium, indicators.ma_slow];
    const sorted = [...mas].sort((a, b) => a - b);
    
    if (JSON.stringify(mas) === JSON.stringify(sorted)) return 'bullish';
    if (JSON.stringify(mas) === JSON.stringify(sorted.reverse())) return 'bearish';
    return 'mixed';
}

function calculateMA(prices, period) {
    const sum = prices.slice(0, period).reduce((a, b) => a + b, 0);
    return sum / period;
}

function identifyChartPatterns(candles, swingHighs, swingLows) {
    // Simplified pattern detection
    const patterns = [];
    
    // Check for double top/bottom
    if (swingHighs.length >= 2) {
        const diff = Math.abs(swingHighs[0].price - swingHighs[1].price) / swingHighs[0].price;
        if (diff < 0.01) patterns.push('double_top');
    }
    
    if (swingLows.length >= 2) {
        const diff = Math.abs(swingLows[0].price - swingLows[1].price) / swingLows[0].price;
        if (diff < 0.01) patterns.push('double_bottom');
    }
    
    return patterns;
}

module.exports = xauusdController;