/**
 * Fee Tier Progression Model
 * 
 * Models 30-day expected value considering:
 * - Kraken fee tier progression
 * - Temporal volume patterns (hourly/daily)
 * - Compounding strategies
 * - Exit target optimization per tier
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class FeeTierProgressionModel {
    constructor(config = {}) {
        this.config = {
            initialCapital: config.initialCapital || 1000,
            exitTargets: config.exitTargets || {
                '0.40%': { target: 0.004, label: 'Volume Building' },
                '0.45%': { target: 0.0045, label: 'Balanced Volume' },
                '0.50%': { target: 0.005, label: 'Balanced Profit' },
                '0.54%': { target: 0.0054, label: 'Goldilocks' },
                '0.55%': { target: 0.0055, label: 'Max Profit/Trade' }
            },
            // Kraken fee tiers (maker fees)
            feeTiers: [
                { volume: 0, maker: 0.0025, taker: 0.0040, name: 'Starter' },
                { volume: 10001, maker: 0.0020, taker: 0.0035, name: 'Bronze' },
                { volume: 50001, maker: 0.0014, taker: 0.0024, name: 'Silver' },
                { volume: 100001, maker: 0.0012, taker: 0.0022, name: 'Gold' },
                { volume: 250001, maker: 0.0010, taker: 0.0020, name: 'Platinum' },
                { volume: 500001, maker: 0.0008, taker: 0.0018, name: 'Diamond' },
                { volume: 1000001, maker: 0.0006, taker: 0.0016, name: 'Master' },
                { volume: 2500001, maker: 0.0004, taker: 0.0014, name: 'Grandmaster' },
                { volume: 5000001, maker: 0.0002, taker: 0.0012, name: 'Champion' },
                { volume: 10000001, maker: 0.0000, taker: 0.0010, name: 'Legend' }
            ],
            // Temporal patterns (simplified - would load from service)
            temporalPatterns: {
                hourly: config.temporalPatterns?.hourly || this.getDefaultHourlyPattern(),
                daily: config.temporalPatterns?.daily || this.getDefaultDailyPattern()
            },
            // Strategy settings
            compoundingStrategy: config.compoundingStrategy || 'full', // 'none', 'partial', 'full'
            compoundingRate: config.compoundingRate || 1.0, // What fraction to reinvest
            stopLoss: config.stopLoss || 0.01,
            maxHoldTime: config.maxHoldTime || 240, // minutes
            ...config
        };
        
        // Goldilocks analysis results (from our backtest)
        this.goldilocksResults = {
            '0.40%': { trades: 203, successRate: 1.0, avgHoldTime: 90, profitPerTrade: 0 },
            '0.41%': { trades: 151, successRate: 1.0, avgHoldTime: 95, profitPerTrade: 0.0001 },
            '0.42%': { trades: 125, successRate: 1.0, avgHoldTime: 94, profitPerTrade: 0.0002 },
            '0.43%': { trades: 109, successRate: 1.0, avgHoldTime: 92, profitPerTrade: 0.0003 },
            '0.44%': { trades: 94, successRate: 1.0, avgHoldTime: 97, profitPerTrade: 0.0004 },
            '0.45%': { trades: 78, successRate: 1.0, avgHoldTime: 98, profitPerTrade: 0.0005 },
            '0.46%': { trades: 78, successRate: 1.0, avgHoldTime: 99, profitPerTrade: 0.0006 },
            '0.47%': { trades: 73, successRate: 1.0, avgHoldTime: 101, profitPerTrade: 0.0007 },
            '0.48%': { trades: 70, successRate: 1.0, avgHoldTime: 103, profitPerTrade: 0.0008 },
            '0.49%': { trades: 68, successRate: 1.0, avgHoldTime: 104, profitPerTrade: 0.0009 },
            '0.50%': { trades: 65, successRate: 1.0, avgHoldTime: 107, profitPerTrade: 0.001 },
            '0.51%': { trades: 56, successRate: 1.0, avgHoldTime: 106, profitPerTrade: 0.0011 },
            '0.52%': { trades: 50, successRate: 1.0, avgHoldTime: 108, profitPerTrade: 0.0012 },
            '0.53%': { trades: 49, successRate: 1.0, avgHoldTime: 108, profitPerTrade: 0.0013 },
            '0.54%': { trades: 49, successRate: 1.0, avgHoldTime: 115, profitPerTrade: 0.0014 },
            '0.55%': { trades: 44, successRate: 1.0, avgHoldTime: 118, profitPerTrade: 0.0015 }
        };
    }
    
    getDefaultHourlyPattern() {
        // Simplified hourly pattern (0-23 hours UTC)
        // In production, would load from temporal-pattern-loader-service
        return {
            0: 0.7,   // Midnight UTC - Lower volume
            1: 0.6,   // 1 AM UTC
            2: 0.6,   // 2 AM UTC
            3: 0.7,   // 3 AM UTC
            4: 0.8,   // 4 AM UTC
            5: 0.9,   // 5 AM UTC
            6: 1.0,   // 6 AM UTC - Europe opening
            7: 1.1,   // 7 AM UTC
            8: 1.2,   // 8 AM UTC - Peak Europe
            9: 1.3,   // 9 AM UTC
            10: 1.2,  // 10 AM UTC
            11: 1.1,  // 11 AM UTC
            12: 1.0,  // Noon UTC
            13: 1.1,  // 1 PM UTC - US East Coast opening
            14: 1.3,  // 2 PM UTC - US markets active
            15: 1.4,  // 3 PM UTC - Peak overlap
            16: 1.3,  // 4 PM UTC
            17: 1.2,  // 5 PM UTC
            18: 1.0,  // 6 PM UTC
            19: 0.9,  // 7 PM UTC
            20: 0.8,  // 8 PM UTC - US winding down
            21: 0.8,  // 9 PM UTC
            22: 0.7,  // 10 PM UTC
            23: 0.7   // 11 PM UTC
        };
    }
    
    getDefaultDailyPattern() {
        // Weekly pattern (0=Sunday, 6=Saturday)
        return {
            0: 0.7,  // Sunday - Lower volume
            1: 1.0,  // Monday
            2: 1.1,  // Tuesday
            3: 1.2,  // Wednesday - Peak
            4: 1.1,  // Thursday
            5: 1.0,  // Friday
            6: 0.8   // Saturday - Lower volume
        };
    }
    
    /**
     * Calculate optimal exit target for current fee tier
     */
    getOptimalExitTarget(currentFee) {
        // Round trip cost
        const roundTripFee = currentFee * 2;
        
        // Find the best exit target for this fee level
        let bestTarget = '0.54%'; // Default to goldilocks
        let bestScore = -Infinity;
        
        for (const [targetKey, data] of Object.entries(this.goldilocksResults)) {
            const target = parseFloat(targetKey) / 100;
            const profitPerTrade = target - roundTripFee;
            
            if (profitPerTrade > 0) {
                // Score based on total expected profit (trades * profit per trade)
                const score = data.trades * profitPerTrade;
                if (score > bestScore) {
                    bestScore = score;
                    bestTarget = targetKey;
                }
            }
        }
        
        return {
            target: bestTarget,
            expectedProfit: bestScore,
            data: this.goldilocksResults[bestTarget]
        };
    }
    
    /**
     * Simulate 30-day progression
     */
    async simulate30Days(options = {}) {
        const results = {
            startCapital: this.config.initialCapital,
            endCapital: this.config.initialCapital,
            totalVolume: 0,
            totalTrades: 0,
            totalProfit: 0,
            feesPaid: 0,
            feeSavings: 0,
            dailyResults: [],
            tierProgression: [],
            currentTier: this.config.feeTiers[0]
        };
        
        let currentCapital = this.config.initialCapital;
        let rolling30DayVolume = 0;
        let currentTierIndex = 0;
        
        // Track when we reach each tier
        const tierMilestones = [];
        
        for (let day = 0; day < 30; day++) {
            const dayOfWeek = day % 7;
            const dailyMultiplier = this.config.temporalPatterns.daily[dayOfWeek];
            
            const dayResult = {
                day: day + 1,
                dayOfWeek,
                startCapital: currentCapital,
                trades: [],
                totalTrades: 0,
                totalVolume: 0,
                totalProfit: 0,
                feesPaid: 0
            };
            
            // Simulate each hour of the day
            for (let hour = 0; hour < 24; hour++) {
                const hourlyMultiplier = this.config.temporalPatterns.hourly[hour];
                const combinedMultiplier = dailyMultiplier * hourlyMultiplier;
                
                // Get current fee tier
                const currentFee = this.config.feeTiers[currentTierIndex].maker;
                
                // Get optimal exit target for current fee tier
                const optimalExit = this.getOptimalExitTarget(currentFee);
                const baselineData = optimalExit.data;
                
                // Calculate expected trades this hour (based on 12-hour baseline)
                const expectedTradesPerHour = (baselineData.trades / 12) * combinedMultiplier;
                const actualTrades = Math.floor(expectedTradesPerHour + Math.random());
                
                if (actualTrades > 0) {
                    // Execute trades
                    for (let trade = 0; trade < actualTrades; trade++) {
                        const tradeSize = currentCapital * 0.9; // Use 90% of capital per trade
                        const roundTripFee = currentFee * 2;
                        
                        // Calculate profit correctly - profitPerTrade is already net of fees
                        const netProfitRate = baselineData.profitPerTrade;
                        const netProfit = netProfitRate * tradeSize;
                        const fees = roundTripFee * tradeSize;
                        
                        dayResult.trades.push({
                            hour,
                            size: tradeSize,
                            grossProfit: netProfit + fees, // Gross profit before fees
                            fees,
                            netProfit,
                            exitTarget: optimalExit.target,
                            feeRate: currentFee
                        });
                        
                        dayResult.totalVolume += tradeSize;
                        dayResult.totalProfit += netProfit;
                        dayResult.feesPaid += fees;
                        
                        // Apply compounding
                        if (this.config.compoundingStrategy !== 'none') {
                            const profitToReinvest = netProfit * this.config.compoundingRate;
                            currentCapital += profitToReinvest;
                        }
                    }
                    
                    dayResult.totalTrades += actualTrades;
                }
            }
            
            // Update rolling 30-day volume
            rolling30DayVolume += dayResult.totalVolume;
            
            // Check for tier upgrade
            const newTierIndex = this.findTierIndex(rolling30DayVolume);
            if (newTierIndex > currentTierIndex) {
                const oldTier = this.config.feeTiers[currentTierIndex];
                const newTier = this.config.feeTiers[newTierIndex];
                
                tierMilestones.push({
                    day: day + 1,
                    volume: rolling30DayVolume,
                    fromTier: oldTier.name,
                    toTier: newTier.name,
                    feeReduction: ((oldTier.maker - newTier.maker) * 100).toFixed(3) + '%'
                });
                
                currentTierIndex = newTierIndex;
                results.currentTier = newTier;
            }
            
            dayResult.endCapital = currentCapital;
            dayResult.capitalGrowth = ((currentCapital - dayResult.startCapital) / dayResult.startCapital * 100).toFixed(2) + '%';
            
            results.dailyResults.push(dayResult);
            results.totalVolume += dayResult.totalVolume;
            results.totalTrades += dayResult.totalTrades;
            results.totalProfit += dayResult.totalProfit;
            results.feesPaid += dayResult.feesPaid;
        }
        
        // Calculate fee savings
        const baselineFees = results.totalVolume * this.config.feeTiers[0].maker * 2;
        results.feeSavings = baselineFees - results.feesPaid;
        
        results.endCapital = currentCapital;
        results.totalReturn = ((currentCapital - this.config.initialCapital) / this.config.initialCapital * 100).toFixed(2) + '%';
        results.tierProgression = tierMilestones;
        results.finalTier = this.config.feeTiers[currentTierIndex];
        results.avgTradesPerDay = (results.totalTrades / 30).toFixed(1);
        results.avgVolumePerDay = (results.totalVolume / 30).toFixed(0);
        
        return results;
    }
    
    /**
     * Find tier index for given volume
     */
    findTierIndex(volume) {
        for (let i = this.config.feeTiers.length - 1; i >= 0; i--) {
            if (volume >= this.config.feeTiers[i].volume) {
                return i;
            }
        }
        return 0;
    }
    
    /**
     * Compare different strategies
     */
    async compareStrategies() {
        console.log('🔄 Comparing 30-Day Strategies...\n');
        
        const strategies = [
            { 
                name: 'Volume Focus (0.40%)', 
                exitTarget: '0.40%',
                compounding: 'none'
            },
            { 
                name: 'Balanced (0.45%)', 
                exitTarget: '0.45%',
                compounding: 'partial'
            },
            { 
                name: 'Goldilocks (0.54%)', 
                exitTarget: '0.54%',
                compounding: 'full'
            },
            { 
                name: 'Max Profit (0.55%)', 
                exitTarget: '0.55%',
                compounding: 'full'
            },
            { 
                name: 'Dynamic (Tier-Optimized)', 
                exitTarget: 'dynamic',
                compounding: 'full'
            }
        ];
        
        const results = [];
        
        for (const strategy of strategies) {
            // Configure model for this strategy
            if (strategy.exitTarget !== 'dynamic') {
                // Override goldilocks results to force specific exit
                const target = parseFloat(strategy.exitTarget) / 100;
                this.goldilocksResults = {
                    [strategy.exitTarget]: this.goldilocksResults[strategy.exitTarget]
                };
            }
            
            this.config.compoundingStrategy = strategy.compounding;
            
            const result = await this.simulate30Days();
            results.push({
                strategy: strategy.name,
                ...result
            });
            
            // Restore goldilocks results
            this.goldilocksResults = {
                '0.40%': { trades: 203, successRate: 1.0, avgHoldTime: 90, profitPerTrade: 0 },
                '0.41%': { trades: 151, successRate: 1.0, avgHoldTime: 95, profitPerTrade: 0.0001 },
                '0.42%': { trades: 125, successRate: 1.0, avgHoldTime: 94, profitPerTrade: 0.0002 },
                '0.43%': { trades: 109, successRate: 1.0, avgHoldTime: 92, profitPerTrade: 0.0003 },
                '0.44%': { trades: 94, successRate: 1.0, avgHoldTime: 97, profitPerTrade: 0.0004 },
                '0.45%': { trades: 78, successRate: 1.0, avgHoldTime: 98, profitPerTrade: 0.0005 },
                '0.46%': { trades: 78, successRate: 1.0, avgHoldTime: 99, profitPerTrade: 0.0006 },
                '0.47%': { trades: 73, successRate: 1.0, avgHoldTime: 101, profitPerTrade: 0.0007 },
                '0.48%': { trades: 70, successRate: 1.0, avgHoldTime: 103, profitPerTrade: 0.0008 },
                '0.49%': { trades: 68, successRate: 1.0, avgHoldTime: 104, profitPerTrade: 0.0009 },
                '0.50%': { trades: 65, successRate: 1.0, avgHoldTime: 107, profitPerTrade: 0.001 },
                '0.51%': { trades: 56, successRate: 1.0, avgHoldTime: 106, profitPerTrade: 0.0011 },
                '0.52%': { trades: 50, successRate: 1.0, avgHoldTime: 108, profitPerTrade: 0.0012 },
                '0.53%': { trades: 49, successRate: 1.0, avgHoldTime: 108, profitPerTrade: 0.0013 },
                '0.54%': { trades: 49, successRate: 1.0, avgHoldTime: 115, profitPerTrade: 0.0014 },
                '0.55%': { trades: 44, successRate: 1.0, avgHoldTime: 118, profitPerTrade: 0.0015 }
            };
        }
        
        return results;
    }
    
    /**
     * Generate detailed report
     */
    generateReport(results) {
        console.log('\n📊 30-DAY EXPECTED VALUE REPORT');
        console.log('═══════════════════════════════════════════════════════════════════\n');
        
        console.log(`Initial Capital: $${results.startCapital}`);
        console.log(`Final Capital: $${results.endCapital.toFixed(2)}`);
        console.log(`Total Return: ${results.totalReturn}`);
        console.log(`Total Volume: $${results.totalVolume.toLocaleString()}`);
        console.log(`Total Trades: ${results.totalTrades}`);
        console.log(`Fees Paid: $${results.feesPaid.toFixed(2)}`);
        console.log(`Fee Savings: $${results.feeSavings.toFixed(2)}`);
        console.log(`Final Tier: ${results.finalTier.name} (${(results.finalTier.maker * 100).toFixed(2)}% maker fee)`);
        
        if (results.tierProgression.length > 0) {
            console.log('\n🎯 TIER PROGRESSION:');
            results.tierProgression.forEach(milestone => {
                console.log(`  Day ${milestone.day}: ${milestone.fromTier} → ${milestone.toTier} (${milestone.feeReduction} reduction)`);
            });
        }
        
        console.log('\n📈 WEEKLY SUMMARY:');
        for (let week = 0; week < 4; week++) {
            const weekDays = results.dailyResults.slice(week * 7, (week + 1) * 7);
            const weekVolume = weekDays.reduce((sum, d) => sum + d.totalVolume, 0);
            const weekProfit = weekDays.reduce((sum, d) => sum + d.totalProfit, 0);
            const weekTrades = weekDays.reduce((sum, d) => sum + d.totalTrades, 0);
            
            console.log(`  Week ${week + 1}: Volume $${weekVolume.toLocaleString()} | Profit $${weekProfit.toFixed(2)} | ${weekTrades} trades`);
        }
        
        return results;
    }
}

// Export for use
export default FeeTierProgressionModel;