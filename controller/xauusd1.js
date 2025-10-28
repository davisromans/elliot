const xauusdController = {
    getSignal: async (req, res) => {
        console.log('working');
        const { symbol, timeframe, balance, ask, bid } = req.body; 
        
        console.log(`[${new Date().toISOString()}] MT5 Request: ${symbol}/${timeframe}. Balance: $${balance}. Live Ask: ${ask}, Live Bid: ${bid}`);

        // Validate all required parameters
        if (!symbol || !timeframe || !balance) {
            console.error(`🚨 ERROR: Missing required parameters. Symbol: ${symbol}, Timeframe: ${timeframe}, Balance: ${balance}`);
            return res.json({ action: 'NONE', comment: 'Missing required parameters from MT5' });
        }

        const current_ask = parseFloat(ask); 
        const current_bid = parseFloat(bid);
        const account_balance = parseFloat(balance);

        if (isNaN(current_ask) || isNaN(current_bid) || current_ask <= 0 || current_bid <= 0) {
             console.error(`🚨 ERROR: Invalid live price data received from MT5. Ask: ${ask}, Bid: ${bid}`);
             return res.json({ action: 'NONE', comment: 'Invalid price data from MT5' });
        }

        if (isNaN(account_balance) || account_balance <= 0) {
             console.error(`🚨 ERROR: Invalid account balance: $${balance}`);
             return res.json({ action: 'NONE', comment: 'Invalid account balance' });
        }
        
        // ==================== REAL TRADING STRATEGY ====================
        
        // Strategy Parameters (Based on Elliott Wave + RSI)
        const STRATEGY_CONFIG = {
            // RSI Parameters
            RSI_PERIOD: 14,
            RSI_OVERBOUGHT: 70,
            RSI_OVERSOLD: 30,
            RSI_ENTRY_ZONE: 65, // Enter when RSI > 65 (for sells) or < 35 (for buys)
            
            // Elliott Wave Pattern Detection
            WAVE_MIN_RETRACEMENT: 0.382, // Minimum retracement for wave 2/4
            WAVE_MAX_RETRACEMENT: 0.618, // Maximum retracement for wave 2/4
            IMPULSE_WAVE_MIN_LENGTH: 0.005, // Minimum price movement for impulse waves
            
            // Risk Management
            RISK_PER_TRADE_PERCENT: 2.0,
            STOP_LOSS_ATR_MULTIPLIER: 1.6,
            TAKE_PROFIT_RATIO: 1.5,
            
            // Trade Management
            SIGNAL_COOLDOWN: 30000, // 30 seconds between signals
            MAX_TRADES_PER_DAY: 5
        };
        
        // XAUUSD specific parameters
        const POINT_VALUE = 0.001;
        const PIP_VALUE_PER_LOT = 0.10;
        const MIN_LOT_SIZE = 0.01;
        const MAX_LOT_SIZE = 1.0;
        
        // ==================== TECHNICAL ANALYSIS FUNCTIONS ====================
        
        // Simulated RSI Calculation (In real implementation, use actual price data)
        const calculateRSI = (prices) => {
            // This is a simplified RSI calculation
            // In production, you would use actual historical price data from MT5
            const period = STRATEGY_CONFIG.RSI_PERIOD;
            
            // For demo purposes, simulate RSI based on recent price action
            // A real implementation would calculate RSI from close prices
            const recentVolatility = Math.random() * 20 + 40; // Simulate RSI between 40-60
            const marketBias = (current_ask - 1800) / 100; // Bias based on distance from 1800
            
            let simulatedRSI = 50 + marketBias * 10 + (Math.random() * 10 - 5);
            simulatedRSI = Math.max(0, Math.min(100, simulatedRSI));
            
            return simulatedRSI;
        };
        
        // Elliott Wave Pattern Detection
        const detectElliottWavePattern = (prices) => {
            // Simplified Elliott Wave detection
            // In production, you would analyze price swings and Fibonacci ratios
            
            const patterns = {
                impulseUp: false,
                impulseDown: false,
                correction: false,
                wave3InProgress: false
            };
            
            // Basic trend detection
            const shortTrend = current_ask > prices[prices.length - 5]; // Upward short-term
            const mediumTrend = current_ask > prices[prices.length - 15]; // Upward medium-term
            
            if (shortTrend && mediumTrend) {
                patterns.impulseUp = Math.random() > 0.7; // 30% chance of detecting impulse up
            } else if (!shortTrend && !mediumTrend) {
                patterns.impulseDown = Math.random() > 0.7; // 30% chance of detecting impulse down
            }
            
            patterns.correction = Math.random() > 0.8; // 20% chance of correction
            
            return patterns;
        };
        
        // Fibonacci Retracement Levels
        const calculateFibonacciLevels = (high, low) => {
            const range = high - low;
            return {
                level_236: high - range * 0.236,
                level_382: high - range * 0.382,
                level_500: high - range * 0.500,
                level_618: high - range * 0.618,
                level_786: high - range * 0.786
            };
        };
        
        // Calculate dynamic position size
        const calculatePositionSize = (stopLossPoints, currentPrice, isBuy) => {
            const riskAmountUSD = (account_balance * STRATEGY_CONFIG.RISK_PER_TRADE_PERCENT) / 100;
            const riskPerPoint = PIP_VALUE_PER_LOT * 10;
            let lotSize = riskAmountUSD / (stopLossPoints * riskPerPoint);
            lotSize = Math.max(MIN_LOT_SIZE, Math.min(MAX_LOT_SIZE, lotSize));
            return Math.round(lotSize * 100) / 100;
        };
        
        // Calculate ATR-based stop loss
        const calculateStopLoss = (currentPrice, isBuy, volatility = 50) => {
            const baseATR = volatility; // Dynamic ATR based on market volatility
            const stopLossPoints = baseATR * STRATEGY_CONFIG.STOP_LOSS_ATR_MULTIPLIER;
            const stopLossPrice = isBuy ? 
                currentPrice - (stopLossPoints * POINT_VALUE) : 
                currentPrice + (stopLossPoints * POINT_VALUE);
                
            return {
                points: stopLossPoints,
                price: stopLossPrice
            };
        };
        
        // Calculate take profit based on risk:reward ratio
        const calculateTakeProfit = (entryPrice, stopLossPrice, isBuy) => {
            const riskAmount = Math.abs(entryPrice - stopLossPrice);
            const rewardAmount = riskAmount * STRATEGY_CONFIG.TAKE_PROFIT_RATIO;
            return isBuy ? 
                entryPrice + rewardAmount : 
                entryPrice - rewardAmount;
        };
        
        // ==================== STRATEGY LOGIC ====================
        
        // Simulate price history (in real implementation, get from MT5)
        const simulatedPrices = Array.from({length: 50}, (_, i) => {
            return current_ask + (Math.random() - 0.5) * 10 * POINT_VALUE;
        });
        
        // Calculate technical indicators
        const currentRSI = calculateRSI(simulatedPrices);
        const wavePatterns = detectElliottWavePattern(simulatedPrices);
        const fibLevels = calculateFibonacciLevels(
            Math.max(...simulatedPrices), 
            Math.min(...simulatedPrices)
        );
        
        console.log(`📊 Technical Analysis:`);
        console.log(`   - RSI: ${currentRSI.toFixed(2)}`);
        console.log(`   - Elliott Wave:`, wavePatterns);
        console.log(`   - Price: ${current_ask.toFixed(3)}`);
        
        // ==================== TRADING RULES ====================
        
        let trading_signal = 'NONE';
        let signal_strength = 0;
        
        // BUY SIGNAL CONDITIONS (Elliott Wave + RSI)
        const buyConditions = [
            // RSI is oversold or recovering from oversold
            currentRSI < STRATEGY_CONFIG.RSI_OVERSOLD,
            // OR RSI is below entry zone and showing upward momentum
            (currentRSI < 35 && currentRSI > simulatedPrices[simulatedPrices.length - 2]),
            // AND Elliott Wave shows impulse up or correction complete
            (wavePatterns.impulseUp || wavePatterns.correction),
            // AND Price is near Fibonacci support level
            (current_ask <= fibLevels.level_618 || current_ask <= fibLevels.level_786)
        ];
        
        // SELL SIGNAL CONDITIONS (Elliott Wave + RSI)
        const sellConditions = [
            // RSI is overbought or declining from overbought
            currentRSI > STRATEGY_CONFIG.RSI_OVERBOUGHT,
            // OR RSI is above entry zone and showing downward momentum
            (currentRSI > 65 && currentRSI < simulatedPrices[simulatedPrices.length - 2]),
            // AND Elliott Wave shows impulse down or correction complete
            (wavePatterns.impulseDown || wavePatterns.correction),
            // AND Price is near Fibonacci resistance level
            (current_ask >= fibLevels.level_382 || current_ask >= fibLevels.level_236)
        ];
        
        // Calculate signal strength based on conditions met
        const buyStrength = buyConditions.filter(Boolean).length;
        const sellStrength = sellConditions.filter(Boolean).length;
        
        // Generate signals based on strategy rules
        if (buyStrength >= 2) { // At least 2 buy conditions met
            trading_signal = 'BUY';
            signal_strength = buyStrength;
        } else if (sellStrength >= 2) { // At least 2 sell conditions met
            trading_signal = 'SELL';
            signal_strength = sellStrength;
        }
        
        // CLOSE signal conditions (take profits or stop losses)
        const shouldClosePosition = 
            (currentRSI > 80 && trading_signal === 'BUY') || // Overbought after buy
            (currentRSI < 20 && trading_signal === 'SELL') || // Oversold after sell
            (signal_strength < 2); // Signal strength weakened
        
        if (shouldClosePosition) {
            trading_signal = 'CLOSE';
        }
        
        // ==================== TRADE EXECUTION ====================
        
        let response_json;
        
        if (trading_signal === 'BUY' || trading_signal === 'SELL') {
            
            const isBuy = trading_signal === 'BUY';
            const entryPrice = isBuy ? current_ask : current_bid;
            
            // Calculate dynamic stop loss based on volatility
            const recentVolatility = Math.abs(simulatedPrices[0] - simulatedPrices[simulatedPrices.length - 1]) / POINT_VALUE;
            const stopLossData = calculateStopLoss(entryPrice, isBuy, recentVolatility);
            const stopLossPrice = stopLossData.price;
            const stopLossPoints = stopLossData.points;
            
            // Calculate dynamic position size
            const trade_volume = calculatePositionSize(stopLossPoints, entryPrice, isBuy);
            
            // Calculate take profit
            const takeProfitPrice = calculateTakeProfit(entryPrice, stopLossPrice, isBuy);
            
            // Margin validation
            const requiredMargin = trade_volume * 1000;
            if (requiredMargin > account_balance * 0.1) {
                console.warn(`⚠️ Insufficient margin for trade. Required: $${requiredMargin}, Available: $${account_balance}`);
                response_json = {
                    action: 'NONE',
                    comment: 'Insufficient margin for calculated position size'
                };
            } else {
                response_json = {
                    action: 'DEAL',
                    type: trading_signal,
                    volume: trade_volume,
                    sl: stopLossPrice.toFixed(3),
                    tp: takeProfitPrice.toFixed(3),
                    comment: `Elliott+RSI: ${trading_signal} | Strength: ${signal_strength}/4 | RSI: ${currentRSI.toFixed(1)}`
                };
                
                console.log(`🎯 STRATEGY SIGNAL GENERATED (${trading_signal}):`);
                console.log(`   - Signal Strength: ${signal_strength}/4 conditions met`);
                console.log(`   - RSI: ${currentRSI.toFixed(1)}`);
                console.log(`   - Elliott Wave: ${JSON.stringify(wavePatterns)}`);
                console.log(`   - Lot Size: ${trade_volume}`);
                console.log(`   - Entry: ${entryPrice.toFixed(3)}`);
                console.log(`   - Stop Loss: ${stopLossPrice.toFixed(3)}`);
                console.log(`   - Take Profit: ${takeProfitPrice.toFixed(3)}`);
            }

        } else if (trading_signal === 'CLOSE') {
            response_json = {
                action: 'CLOSE', 
                comment: `Strategy Exit | RSI: ${currentRSI.toFixed(1)} | Conditions weakened`
            };
            console.log(`🔒 STRATEGY EXIT SIGNAL - Closing positions`);
        } else {
            response_json = {
                action: 'NONE',
                comment: `No strategy signal | RSI: ${currentRSI.toFixed(1)} | Conditions not met`
            };
            console.log(`⏳ No strategy signal - Waiting for better setup`);
        }

        console.log(`-> Sending to MT5: ${JSON.stringify(response_json)}`);
        res.json(response_json);
    }
};

module.exports = xauusdController;