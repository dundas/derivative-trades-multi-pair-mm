/**
 * Enhanced Multi-Pair Trader with Adaptive Decision Engine
 * 
 * Integrates the AdaptiveDecisionEngine with our existing multi-pair infrastructure:
 * - MultiPairDataCollector
 * - FuturesEdgeExpectedValueModel  
 * - StreamlinedTemporalAnalyzer
 * - WeightedDecisionEngine
 */

import { MultiPairOpportunisticTrader } from './multi-pair-opportunistic-trader.js';
import { AdaptiveDecisionEngine } from './adaptive-decision-engine.js';
import { MultiPairDataCollector } from './multi-pair-data-collector.js';
import { FuturesEdgeExpectedValueModel } from './futures-edge-expected-value-model.js';
import { StreamlinedTemporalAnalyzer } from './streamlined-temporal-analyzer.js';
import { WeightedDecisionEngine } from './weighted-decision-engine.js';

export class EnhancedMultiPairTrader extends MultiPairOpportunisticTrader {
    constructor(config = {}) {
        super(config);
        
        // Initialize the adaptive decision engine with pair-specific limits
        this.adaptiveDecisionEngine = new AdaptiveDecisionEngine({
            maxPositionSizePercent: config.maxPositionSizePercent || 0.1,
            maxConcurrentPairs: config.maxConcurrentPairs || 3,
            capitalAllocationStrategy: config.capitalAllocationStrategy || 'weighted_by_confidence',
            ...config.adaptiveEngine
        });
        
        // Enhanced configuration
        this.config = {
            ...this.config,
            useAdaptiveTargets: config.useAdaptiveTargets !== false, // Default true
            minConfidenceThreshold: config.minConfidenceThreshold || 0.3,
            enablePairSpecificOptimization: config.enablePairSpecificOptimization !== false,
            rebalanceFrequency: config.rebalanceFrequency || 300000, // 5 minutes
            performanceTrackingEnabled: config.performanceTrackingEnabled !== false
        };
        
        // Performance tracking
        this.performanceMetrics = {
            executedTrades: [],
            rejectedOpportunities: [],
            pairPerformance: {},
            adaptiveTargetHistory: [],
            lastRebalance: Date.now()
        };
        
        console.log('🤖 Enhanced Multi-Pair Trader initialized with Adaptive Decision Engine');
    }
    
    /**
     * Enhanced opportunity detection with adaptive decision making
     * Overrides the base class method to include our adaptive logic
     */
    async detectAndExecuteOpportunities() {
        console.log('\n🔍 Enhanced Multi-Pair Opportunity Detection Starting...');
        
        try {
            // 1. Collect multi-pair data (from existing system)
            const multiPairData = await this.dataCollector.collectAllPairData();
            console.log(`📊 Collected data for ${Object.keys(multiPairData).length} pairs`);
            
            // 2. Analyze futures edge signals (from existing system)
            const futuresSignals = await this.analyzeFuturesEdgeSignals(multiPairData);
            
            // 3. Get temporal analysis (from existing system)
            const temporalAnalysis = await this.getTemporalAnalysis();
            
            // 4. Enhanced: Generate opportunities with adaptive targeting
            const enhancedOpportunities = await this.generateEnhancedOpportunities(
                multiPairData, 
                futuresSignals, 
                temporalAnalysis
            );
            
            // 5. Enhanced: Use adaptive decision engine for optimal selections
            const optimalDecisions = await this.makeAdaptiveDecisions(enhancedOpportunities);
            
            // 6. Execute approved trades
            const executionResults = await this.executeApprovedTrades(optimalDecisions);
            
            // 7. Update performance tracking
            this.updatePerformanceMetrics(optimalDecisions, executionResults);
            
            // 8. Rebalance if needed
            await this.conditionalRebalance();
            
            return {
                opportunitiesFound: enhancedOpportunities.length,
                decisionsApproved: optimalDecisions.filter(d => d.action === 'EXECUTE').length,
                tradesExecuted: executionResults.successful.length,
                performanceSummary: this.getPerformanceSummary()
            };
            
        } catch (error) {
            console.error('❌ Enhanced opportunity detection failed:', error.message);
            throw error;
        }
    }
    
    /**
     * Generate enhanced opportunities using our existing multi-pair infrastructure
     * but with adaptive targeting
     */
    async generateEnhancedOpportunities(multiPairData, futuresSignals, temporalAnalysis) {
        const opportunities = [];
        
        for (const [pair, pairData] of Object.entries(multiPairData)) {
            try {
                // Get signals from our existing systems
                const futuresSignal = futuresSignals[pair];
                const temporalBias = temporalAnalysis[pair];
                const marketConditions = this.extractMarketConditions(pairData);
                
                // Enhanced: Check if pair has viable opportunities
                if (this.isPairViableForTrading(pair, marketConditions)) {
                    const opportunity = {
                        pair,
                        currentPrice: pairData.spot.price,
                        direction: this.determineDirection(futuresSignal, temporalBias),
                        signal: {
                            futuresSignal: futuresSignal?.signal,
                            temporalBias: temporalBias?.bias || 0,
                            strength: this.calculateSignalStrength(futuresSignal, temporalBias),
                            confidence: this.calculateSignalConfidence(futuresSignal, temporalBias)
                        },
                        marketConditions,
                        availableCapital: await this.getAvailableCapital(),
                        timestamp: Date.now(),
                        source: 'enhanced_multi_pair_system'
                    };
                    
                    opportunities.push(opportunity);
                }
                
            } catch (error) {
                console.warn(`⚠️ Failed to generate opportunity for ${pair}:`, error.message);
            }
        }
        
        console.log(`🎯 Generated ${opportunities.length} enhanced opportunities`);
        return opportunities;
    }
    
    /**
     * Use adaptive decision engine to make optimal trading decisions
     */
    async makeAdaptiveDecisions(opportunities) {
        console.log('\n🤖 Making adaptive trading decisions...');
        
        const decisions = [];
        
        for (const opportunity of opportunities) {
            try {
                // Use our adaptive decision engine
                const decision = await this.adaptiveDecisionEngine.generateTradingDecision(opportunity);
                decisions.push(decision);
                
                // Log the decision
                const action = decision.action === 'EXECUTE' ? '✅' : '❌';
                console.log(`${action} ${decision.pair}: ${decision.exitTargetPercent || 'N/A'} target (confidence: ${(decision.confidence * 100).toFixed(0)}%)`);
                
            } catch (error) {
                console.error(`❌ Decision generation failed for ${opportunity.pair}:`, error.message);
                decisions.push({
                    pair: opportunity.pair,
                    action: 'REJECT',
                    reason: 'DECISION_ENGINE_ERROR',
                    error: error.message
                });
            }
        }
        
        const approved = decisions.filter(d => d.action === 'EXECUTE');
        console.log(`📊 Decisions: ${approved.length} approved, ${decisions.length - approved.length} rejected`);
        
        return decisions;
    }
    
    /**
     * Execute approved trades using our existing order management
     */
    async executeApprovedTrades(decisions) {
        const approvedTrades = decisions.filter(d => d.action === 'EXECUTE');
        const results = { successful: [], failed: [] };
        
        if (approvedTrades.length === 0) {
            console.log('⏭️ No trades approved for execution');
            return results;
        }
        
        console.log(`\n🚀 Executing ${approvedTrades.length} approved trades...`);
        
        for (const trade of approvedTrades) {
            try {
                // Use existing order generation with adaptive targets
                const orderParams = {
                    pair: trade.pair,
                    direction: trade.direction,
                    positionSize: trade.positionSize.size,
                    exitTarget: trade.exitTarget,
                    stopLoss: trade.stopLoss.price,
                    timeHorizon: trade.timeHorizon,
                    adaptiveMetadata: {
                        originalTarget: trade.reasoning?.adaptiveFactors || [],
                        confidence: trade.confidence,
                        marketConditions: trade.reasoning?.marketAssessment
                    }
                };
                
                // Execute using existing order management infrastructure
                const executionResult = await this.executeOrder(orderParams);
                
                if (executionResult.success) {
                    results.successful.push({
                        ...trade,
                        orderId: executionResult.orderId,
                        executedAt: Date.now()
                    });
                    console.log(`✅ ${trade.pair} order placed: ${executionResult.orderId}`);
                } else {
                    results.failed.push({
                        ...trade,
                        error: executionResult.error
                    });
                    console.log(`❌ ${trade.pair} execution failed: ${executionResult.error}`);
                }
                
            } catch (error) {
                console.error(`❌ Trade execution error for ${trade.pair}:`, error.message);
                results.failed.push({
                    ...trade,
                    error: error.message
                });
            }
        }
        
        console.log(`📊 Execution results: ${results.successful.length} successful, ${results.failed.length} failed`);
        return results;
    }
    
    /**
     * Extract market conditions from our existing data collector format
     */
    extractMarketConditions(pairData) {
        return {
            volatility: pairData.volatility || 0.05,
            spread: pairData.spread || 0.02,
            volume: pairData.spot.volume || 0,
            averageVolume: pairData.spot.avgVolume || pairData.spot.volume || 1,
            price: pairData.spot.price,
            futuresPrice: pairData.futures?.price,
            priceSpread: pairData.futures ? 
                Math.abs(pairData.spot.price - pairData.futures.price) / pairData.spot.price : 0
        };
    }
    
    /**
     * Check if pair is viable for trading based on current conditions
     */
    isPairViableForTrading(pair, marketConditions) {
        // Use our adaptive decision engine's pair limits
        const pairLimits = this.adaptiveDecisionEngine.pairLimits[pair];
        if (!pairLimits) {
            console.log(`⚠️ ${pair} not supported by adaptive decision engine`);
            return false;
        }
        
        // Basic viability checks
        if (marketConditions.volume < marketConditions.averageVolume * 0.5) {
            console.log(`⚠️ ${pair} volume too low: ${marketConditions.volume}`);
            return false;
        }
        
        if (marketConditions.spread > pairLimits.spreadBaseline * 5) {
            console.log(`⚠️ ${pair} spread too wide: ${marketConditions.spread}`);
            return false;
        }
        
        return true;
    }
    
    /**
     * Get temporal analysis using our existing StreamlinedTemporalAnalyzer
     */
    async getTemporalAnalysis() {
        try {
            const temporalData = {};
            const currentTime = Date.now();
            
            for (const pair of this.selectedPairs) {
                if (this.temporalAnalyzer) {
                    const bias = this.temporalAnalyzer.getCurrentTemporalBias(pair, currentTime);
                    temporalData[pair] = bias;
                }
            }
            
            return temporalData;
        } catch (error) {
            console.warn('⚠️ Temporal analysis failed:', error.message);
            return {};
        }
    }
    
    /**
     * Analyze futures edge signals using our existing system
     */
    async analyzeFuturesEdgeSignals(multiPairData) {
        try {
            const futuresSignals = {};
            
            for (const [pair, data] of Object.entries(multiPairData)) {
                if (data.futures && this.futuresEdgeModel) {
                    const signal = await this.futuresEdgeModel.analyzeOpportunity(pair, data);
                    futuresSignals[pair] = signal;
                }
            }
            
            return futuresSignals;
        } catch (error) {
            console.warn('⚠️ Futures signal analysis failed:', error.message);
            return {};
        }
    }
    
    /**
     * Update performance metrics with adaptive decision results
     */
    updatePerformanceMetrics(decisions, executionResults) {
        const timestamp = Date.now();
        
        // Track executed trades
        executionResults.successful.forEach(trade => {
            this.performanceMetrics.executedTrades.push({
                ...trade,
                timestamp
            });
        });
        
        // Track rejected opportunities
        const rejected = decisions.filter(d => d.action === 'REJECT');
        rejected.forEach(rejection => {
            this.performanceMetrics.rejectedOpportunities.push({
                ...rejection,
                timestamp
            });
        });
        
        // Track adaptive target history
        const executed = decisions.filter(d => d.action === 'EXECUTE');
        executed.forEach(decision => {
            this.performanceMetrics.adaptiveTargetHistory.push({
                pair: decision.pair,
                target: decision.exitTarget,
                confidence: decision.confidence,
                adaptiveFactors: decision.reasoning?.adaptiveFactors || [],
                timestamp
            });
        });
        
        // Update pair-specific performance
        executed.forEach(decision => {
            if (!this.performanceMetrics.pairPerformance[decision.pair]) {
                this.performanceMetrics.pairPerformance[decision.pair] = {
                    totalTrades: 0,
                    avgTarget: 0,
                    avgConfidence: 0,
                    targets: []
                };
            }
            
            const pairStats = this.performanceMetrics.pairPerformance[decision.pair];
            pairStats.totalTrades++;
            pairStats.targets.push(decision.exitTarget);
            pairStats.avgTarget = pairStats.targets.reduce((sum, t) => sum + t, 0) / pairStats.targets.length;
            pairStats.avgConfidence = (pairStats.avgConfidence * (pairStats.totalTrades - 1) + decision.confidence) / pairStats.totalTrades;
        });
    }
    
    /**
     * Conditional rebalancing based on performance and time
     */
    async conditionalRebalance() {
        const now = Date.now();
        const timeSinceRebalance = now - this.performanceMetrics.lastRebalance;
        
        if (timeSinceRebalance > this.config.rebalanceFrequency) {
            console.log('\n⚖️ Performing periodic rebalancing...');
            
            // Analyze performance by pair
            const performanceAnalysis = this.analyzePerformanceByPair();
            
            // Adjust pair weights based on performance
            await this.adjustPairAllocation(performanceAnalysis);
            
            this.performanceMetrics.lastRebalance = now;
            console.log('✅ Rebalancing complete');
        }
    }
    
    /**
     * Get comprehensive performance summary
     */
    getPerformanceSummary() {
        const adaptiveEngineStats = this.adaptiveDecisionEngine.getPerformanceStats();
        
        return {
            totalDecisions: adaptiveEngineStats.totalDecisions,
            executionRate: adaptiveEngineStats.executionRate,
            avgConfidence: adaptiveEngineStats.avgConfidence,
            pairDistribution: adaptiveEngineStats.pairDistribution,
            adaptiveTargets: adaptiveEngineStats.avgTargetByPair,
            enhancedMetrics: {
                totalExecutedTrades: this.performanceMetrics.executedTrades.length,
                totalRejectedOpportunities: this.performanceMetrics.rejectedOpportunities.length,
                pairPerformance: this.performanceMetrics.pairPerformance
            }
        };
    }
    
    /**
     * Helper methods for signal processing
     */
    determineDirection(futuresSignal, temporalBias) {
        // Combine futures and temporal signals
        let score = 0;
        
        if (futuresSignal?.signal?.direction === 'bullish') score += futuresSignal.signal.strength;
        if (futuresSignal?.signal?.direction === 'bearish') score -= futuresSignal.signal.strength;
        
        if (temporalBias?.bias) score += temporalBias.bias * 0.5;
        
        return score > 0 ? 'long' : 'short';
    }
    
    calculateSignalStrength(futuresSignal, temporalBias) {
        let strength = 0.5; // Base strength
        
        if (futuresSignal?.signal?.strength) {
            strength = Math.max(strength, futuresSignal.signal.strength);
        }
        
        if (temporalBias?.confidence) {
            strength = Math.max(strength, temporalBias.confidence);
        }
        
        return Math.min(1.0, strength);
    }
    
    calculateSignalConfidence(futuresSignal, temporalBias) {
        const confidenceFactors = [];
        
        if (futuresSignal?.confidence) confidenceFactors.push(futuresSignal.confidence);
        if (temporalBias?.confidence) confidenceFactors.push(temporalBias.confidence);
        
        if (confidenceFactors.length === 0) return 0.5;
        
        return confidenceFactors.reduce((sum, c) => sum + c, 0) / confidenceFactors.length;
    }
    
    analyzePerformanceByPair() {
        // Analyze which pairs are performing best with adaptive targeting
        const analysis = {};
        
        for (const [pair, stats] of Object.entries(this.performanceMetrics.pairPerformance)) {
            analysis[pair] = {
                efficiency: stats.avgConfidence * stats.totalTrades,
                avgTarget: stats.avgTarget,
                tradeCount: stats.totalTrades,
                recommendation: stats.avgConfidence > 0.7 ? 'increase' : 'maintain'
            };
        }
        
        return analysis;
    }
    
    async adjustPairAllocation(performanceAnalysis) {
        // Adjust capital allocation based on pair performance
        // This integrates with our existing position sizing logic
        console.log('📊 Performance-based allocation adjustments:');
        
        for (const [pair, analysis] of Object.entries(performanceAnalysis)) {
            console.log(`   ${pair}: ${analysis.recommendation} (efficiency: ${analysis.efficiency.toFixed(2)})`);
        }
    }
}