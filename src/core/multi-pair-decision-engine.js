/**
 * Multi-Pair Decision Engine with Viable Limits
 * 
 * Integrates real-time market conditions with proven viable limits for each pair
 * to generate optimal trading decisions as the multi-pair system runs.
 */

import { createLogger } from '../../utils/logger-factory.js';

const logger = createLogger('multi-pair-decision-engine');

export class MultiPairDecisionEngine {
    constructor(config = {}) {
        this.config = {
            // Budget management
            sessionBudgetPercent: config.sessionBudgetPercent || 0.20, // 20% of USD balance
            minTradeSize: config.minTradeSize || 10, // $10 minimum
            maxTradeSize: config.maxTradeSize || 100, // $100 maximum per trade
            
            // Anti-layering parameters
            priceLayerThreshold: config.priceLayerThreshold || 0.001, // 0.1% price difference required
            
            // Real-time adaptation parameters
            volatilityLookback: config.volatilityLookback || 100, // candles
            spreadThreshold: config.spreadThreshold || 0.5, // bps above normal
            volumeThreshold: config.volumeThreshold || 0.7, // minimum of normal volume
            successRateThreshold: config.successRateThreshold || 0.05, // 5% minimum
            
            // Risk management
            maxPositionSizePercent: config.maxPositionSizePercent || 0.15, // Max 15% of budget per position
            maxTotalExposurePercent: config.maxTotalExposurePercent || 1.0, // Can use 100% of budget
            capitalAllocationStrategy: config.capitalAllocationStrategy || 'weighted_by_confidence',
            
            // Legacy support for maxConcurrentPairs (optional, not enforced if using budget mode)
            maxConcurrentPairs: config.maxConcurrentPairs || null,
            useBudgetMode: config.useBudgetMode !== false, // Default to budget mode
            
            // Exchange integration
            krakenClient: config.krakenClient || null, // KrakenRESTClient instance for fetching pair details
            
            ...config
        };
        
        // Pair-specific viable limits (from our analysis)
        this.pairLimits = {
            'BTC/USD': {
                baselineLimit: 0.004, // 0.40%
                conservativeLimit: 0.004, // 0.40%
                aggressiveLimit: 0.0045, // 0.45% (marginal)
                volatilityClass: 'ultra_low',
                spreadBaseline: 0.0085,
                minSuccessRate: 0.30,
                avgHoldTime: 193,
                characteristics: {
                    stability: 'highest',
                    liquidity: 'highest',
                    predictability: 'high'
                }
            },
            'XRP/USD': {
                baselineLimit: 0.006, // 0.60%
                conservativeLimit: 0.005, // 0.50%
                aggressiveLimit: 0.008, // 0.80%
                volatilityClass: 'low',
                spreadBaseline: 0.0321,
                minSuccessRate: 0.35,
                avgHoldTime: 155,
                characteristics: {
                    stability: 'moderate',
                    liquidity: 'high',
                    predictability: 'moderate'
                }
            },
            'ETH/USD': {
                baselineLimit: 0.010, // 1.00%
                conservativeLimit: 0.007, // 0.70%
                aggressiveLimit: 0.015, // 1.50%
                volatilityClass: 'moderate',
                spreadBaseline: 0.0226,
                minSuccessRate: 0.70,
                avgHoldTime: 96,
                characteristics: {
                    stability: 'moderate',
                    liquidity: 'very_high',
                    predictability: 'good'
                }
            },
            'ADA/USD': {
                baselineLimit: 0.010, // 1.00%
                conservativeLimit: 0.007, // 0.70%
                aggressiveLimit: 0.015, // 1.50%
                volatilityClass: 'high',
                spreadBaseline: 0.3267,
                minSuccessRate: 0.62,
                avgHoldTime: 35,
                characteristics: {
                    stability: 'low',
                    liquidity: 'moderate',
                    predictability: 'moderate'
                }
            },
            'LINK/USD': {
                baselineLimit: 0.010, // 1.00%
                conservativeLimit: 0.007, // 0.70%
                aggressiveLimit: 0.015, // 1.50%
                volatilityClass: 'high',
                spreadBaseline: 0.0044,
                minSuccessRate: 0.71,
                avgHoldTime: 28,
                characteristics: {
                    stability: 'low',
                    liquidity: 'moderate',
                    predictability: 'good'
                }
            }
        };
        
        // Budget and position tracking
        this.budgetState = {
            totalBudget: 0,
            usedBudget: 0,
            availableBudget: 0,
            lastUpdate: 0
        };
        
        // Active positions tracking with price levels
        this.activePositions = new Map(); // tradeId -> position details
        this.pairPositions = new Map(); // pair -> Set of tradeIds
        
        // Real-time market state (legacy support)
        this.marketState = {
            currentVolatility: {},
            currentSpreads: {},
            recentSuccessRates: {},
            currentOpportunities: [],
            activeTrades: {}, // Legacy tracking
            capitalUtilization: 0
        };
        
        // Performance tracking
        this.performance = {
            pairStats: {},
            decisionHistory: [],
            adaptationEvents: []
        };
        
        // Exchange minimum volumes cache
        this.exchangeMinimums = {};
        this.lastMinimumUpdate = 0;
        this.minimumUpdateInterval = 3600000; // 1 hour
        
        // Pacing state initialization
        this.pacingState = {
            sessionStartTime: null,
            currentIntervalStart: null,
            releasedBudget: 0,
            lastTradeTime: null,
            lastTradeTimes: {}, // per-pair tracking
            tradesInInterval: 0,
            totalTradesExecuted: 0,
            budgetReleaseSchedule: []
        };
    }
    
    /**
     * Initialize or update exchange minimums for tracked pairs
     * @param {Array<string>} pairs - Array of trading pairs to load minimums for
     */
    async loadExchangeMinimums(pairs = []) {
        // If no pairs specified, use all pairs from pairLimits
        const pairsToLoad = pairs.length > 0 ? pairs : Object.keys(this.pairLimits);
        
        logger.info(`Loading exchange minimums for ${pairsToLoad.length} pairs...`);
        
        // Check if we have a Kraken client to fetch live data
        if (this.config.krakenClient) {
            try {
                for (const pair of pairsToLoad) {
                    const krakenPair = this.config.krakenClient.formatTradingPair(pair);
                    const response = await this.config.krakenClient.getAssetPairs({ pair: krakenPair });
                    
                    if (response?.result?.[krakenPair]) {
                        const pairInfo = response.result[krakenPair];
                        if (!pairInfo.ordermin || !pairInfo.costmin) {
                            throw new Error(`Missing minimum volume or cost data for ${pair} from Kraken API. ordermin: ${pairInfo.ordermin}, costmin: ${pairInfo.costmin}`);
                        }
                        
                        const minVolume = parseFloat(pairInfo.ordermin);
                        const minCost = parseFloat(pairInfo.costmin);
                        
                        if (isNaN(minVolume) || isNaN(minCost) || minVolume <= 0 || minCost <= 0) {
                            throw new Error(`Invalid minimum volume or cost data for ${pair}. minVolume: ${minVolume}, minCost: ${minCost}`);
                        }
                        
                        this.exchangeMinimums[pair] = {
                            minVolume,
                            minCost,
                            pricePrecision: pairInfo.pair_decimals ? parseInt(pairInfo.pair_decimals) : 2,
                            volumePrecision: pairInfo.lot_decimals ? parseInt(pairInfo.lot_decimals) : 8,
                            lastUpdate: Date.now()
                        };
                        
                        logger.debug(`Loaded minimums for ${pair}:`, {
                            minVolume,
                            minCost,
                            source: 'Kraken API'
                        });
                    }
                }
                
                this.lastMinimumUpdate = Date.now();
            } catch (error) {
                logger.error('Failed to load exchange minimums from API:', error.message);
                throw new Error(`Unable to load exchange minimums from Kraken API: ${error.message}. System requires live data and cannot use fallback values.`);
            }
        } else {
            throw new Error('No Kraken client provided. System requires live exchange data and cannot operate with default values.');
        }
    }
    
    /**
     * Removed: _loadDefaultMinimums method
     * This system now requires live exchange data and will not use fallback/default values
     * to prevent potential financial losses from inaccurate data.
     */
    
    /**
     * Get minimum volume for a specific pair
     * @param {string} pair - Trading pair
     * @returns {number} Minimum volume
     * @throws {Error} If exchange minimum data is not available
     */
    getMinimumVolume(pair) {
        if (!this.exchangeMinimums[pair]?.minVolume) {
            throw new Error(`No exchange minimum data available for ${pair}. System requires live exchange data and cannot use fallback values.`);
        }
        return this.exchangeMinimums[pair].minVolume;
    }
    
    /**
     * Update session budget based on current USD balance
     * Should be called at session start and periodically
     */
    updateSessionBudget(usdBalance) {
        this.budgetState.totalBudget = usdBalance * this.config.sessionBudgetPercent;
        this.budgetState.lastUpdate = Date.now();
        
        // Recalculate available budget
        this._updateAvailableBudget();
        
        logger.info(`Budget updated: $${this.budgetState.totalBudget.toFixed(2)} (${(this.config.sessionBudgetPercent * 100)}% of $${usdBalance.toFixed(2)})`);
    }
    
    /**
     * Main decision function - called in real-time for each trading opportunity
     */
    async generateTradingDecision(opportunity) {
        const {
            pair,
            currentPrice,
            direction, // 'long' or 'short'
            signal, // futures signal, temporal bias, etc.
            marketConditions,
            availableCapital,
            usdBalance // Current USD balance for budget updates
        } = opportunity;
        
        // Update budget if USD balance provided
        if (usdBalance !== undefined && this.config.useBudgetMode) {
            this.updateSessionBudget(usdBalance);
        }
        
        // 1. Get pair-specific limits and characteristics
        const pairConfig = this.pairLimits[pair];
        if (!pairConfig) {
            return this.rejectOpportunity(pair, 'UNSUPPORTED_PAIR');
        }
        
        // 2. Check for layering conflicts (if using budget mode)
        if (this.config.useBudgetMode) {
            const layeringCheck = this.checkForLayering(pair, currentPrice, direction);
            if (layeringCheck.hasConflict) {
                return this.rejectOpportunity(pair, `LAYERING_CONFLICT: ${layeringCheck.reason}`);
            }
        }
        
        // 3. Check pacing constraints
        const pacingCheck = this._checkPacingConstraints(pair);
        if (pacingCheck.shouldReject) {
            return this.rejectOpportunity(pair, `PACING: ${pacingCheck.reason}`);
        }
        
        // 4. Check budget availability (with pacing if using budget mode)
        if (this.config.useBudgetMode) {
            const effectiveBudget = this.config.enablePacing ? 
                Math.min(this.budgetState.availableBudget, this._getEffectiveBudgetWithPacing() - this.budgetState.usedBudget) :
                this.budgetState.availableBudget;
                
            if (effectiveBudget < this.config.minTradeSize) {
                return this.rejectOpportunity(pair, 'INSUFFICIENT_BUDGET');
            }
        }
        
        // 5. Assess current market conditions
        const marketAssessment = await this.assessMarketConditions(pair, marketConditions);
        
        // 6. Calculate adaptive exit target based on current conditions
        const adaptiveTarget = this.calculateAdaptiveExitTarget(pair, marketAssessment, signal);
        
        // 7. Determine position size based on mode
        const positionSize = this.config.useBudgetMode 
            ? this.calculateBudgetBasedPositionSize(pair, adaptiveTarget)
            : this.calculateOptimalPositionSize(pair, availableCapital, adaptiveTarget);
        
        // 7a. Ensure we have exchange minimums loaded (check periodically)
        if (Date.now() - this.lastMinimumUpdate > this.minimumUpdateInterval) {
            this.loadExchangeMinimums([pair]).catch(err => 
                logger.error(`Error updating minimums for ${pair}:`, err.message)
            );
        }
        
        // 8. Validate the decision against risk parameters
        const riskValidation = this.config.useBudgetMode
            ? this.validateBudgetDecision(pair, adaptiveTarget, positionSize)
            : this.validateRiskParameters(pair, adaptiveTarget, positionSize);
        
        // 8a. Adjust position size for exchange minimum volume if needed
        const minVolume = this.getMinimumVolume(pair);
        const volumeInBase = positionSize.size / currentPrice;
        let adjustedPositionSize = positionSize.size;
        let adjustmentMade = false;
        
        if (volumeInBase < minVolume) {
            // Calculate required USD to meet minimum volume
            const requiredUSD = minVolume * currentPrice;
            
            // Check if we have enough budget for the adjustment
            if (this.config.useBudgetMode && requiredUSD <= this.budgetState.availableBudget) {
                adjustedPositionSize = requiredUSD;
                adjustmentMade = true;
                logger.info(`Adjusted ${pair} position from $${positionSize.size.toFixed(2)} to $${requiredUSD.toFixed(2)} to meet minimum volume ${minVolume}`);
            } else if (!this.config.useBudgetMode) {
                adjustedPositionSize = requiredUSD;
                adjustmentMade = true;
            }
        }
        
        // 9. Generate final trading decision
        const decision = {
            timestamp: Date.now(),
            pair,
            action: riskValidation.approved ? 'EXECUTE' : 'REJECT',
            direction,
            entryPrice: currentPrice,
            exitTarget: adaptiveTarget.target,
            exitTargetPercent: (adaptiveTarget.target * 100).toFixed(2) + '%',
            positionSize: adjustedPositionSize,
            positionSizePercent: positionSize.reasoning + (adjustmentMade ? ' (adjusted for min volume)' : ''),
            positionSizeVolume: adjustedPositionSize / currentPrice, // Volume in base currency
            minimumVolume: minVolume,
            volumeAdjusted: adjustmentMade,
            stopLoss: this.calculateStopLoss(pair, currentPrice, direction),
            timeHorizon: adaptiveTarget.expectedHoldTime,
            confidence: adaptiveTarget.confidence,
            expectedReturn: adaptiveTarget.expectedReturn,
            riskReward: adaptiveTarget.expectedReturn / (0.01), // vs 1% stop loss
            reasoning: {
                marketAssessment,
                adaptiveFactors: adaptiveTarget.factors,
                validation: riskValidation,
                pairCharacteristics: pairConfig.characteristics,
                budgetStatus: this.config.useBudgetMode ? {
                    totalBudget: this.budgetState.totalBudget,
                    usedBudget: this.budgetState.usedBudget,
                    availableBudget: this.budgetState.availableBudget
                } : null
            },
            metadata: {
                signalStrength: signal?.strength || 0,
                volatilityAdjustment: adaptiveTarget.volatilityAdjustment,
                spreadAdjustment: adaptiveTarget.spreadAdjustment,
                temporalBias: signal?.temporalBias || null
            }
        };
        
        // 10. Process execution if approved
        if (decision.action === 'EXECUTE') {
            if (this.config.useBudgetMode) {
                this.recordPosition(decision);
            }
            
            // Update pacing state
            if (this.config.enablePacing) {
                this._updatePacingAfterTrade(pair, adjustedPositionSize);
            }
        }
        
        // 11. Log decision and update tracking
        this.logDecision(decision);
        
        return decision;
    }
    
    /**
     * Check for layering conflicts at similar price levels
     */
    checkForLayering(pair, price, direction) {
        const positions = this.pairPositions.get(pair);
        if (!positions || positions.size === 0) {
            return { hasConflict: false };
        }
        
        // Check each active position for this pair
        for (const tradeId of positions) {
            const position = this.activePositions.get(tradeId);
            if (!position) continue;
            
            // Skip if different direction (we can have buy and sell at same level)
            if (position.direction !== direction) continue;
            
            // Calculate price difference percentage
            const priceDiff = Math.abs(price - position.entryPrice) / position.entryPrice;
            
            if (priceDiff < this.config.priceLayerThreshold) {
                return {
                    hasConflict: true,
                    reason: `Existing ${direction} position at $${position.entryPrice.toFixed(2)} (${(priceDiff * 100).toFixed(3)}% difference)`
                };
            }
        }
        
        return { hasConflict: false };
    }
    
    /**
     * Calculate position size based on budget constraints
     */
    calculateBudgetBasedPositionSize(pair, adaptiveTarget) {
        const pairConfig = this.pairLimits[pair];
        
        // Base allocation as percentage of total budget
        let baseAllocation = this.config.maxPositionSizePercent;
        
        // Adjust based on pair characteristics
        if (pairConfig.volatilityClass === 'ultra_low') {
            baseAllocation *= 1.2; // Can allocate more to stable pairs
        } else if (pairConfig.volatilityClass === 'high') {
            baseAllocation *= 0.8; // Reduce allocation to volatile pairs
        }
        
        // Adjust based on confidence
        baseAllocation *= adaptiveTarget.confidence;
        
        // Calculate position size in USD
        let positionSizeUSD = this.budgetState.totalBudget * baseAllocation;
        
        // Apply USD constraints
        positionSizeUSD = Math.max(this.config.minTradeSize, positionSizeUSD);
        positionSizeUSD = Math.min(this.config.maxTradeSize, positionSizeUSD);
        positionSizeUSD = Math.min(this.budgetState.availableBudget, positionSizeUSD);
        
        // Check exchange minimum requirements
        const minVolume = this.getMinimumVolume(pair);
        
        if (!this.exchangeMinimums[pair]?.minCost) {
            throw new Error(`No exchange minimum cost data available for ${pair}. System requires live exchange data and cannot use fallback values.`);
        }
        const minCost = this.exchangeMinimums[pair].minCost;
        
        // If position size in USD is below minimum cost, adjust up
        if (positionSizeUSD < minCost) {
            logger.info(`Adjusting ${pair} position from $${positionSizeUSD.toFixed(2)} to minimum cost $${minCost}`);
            positionSizeUSD = minCost;
        }
        
        return {
            size: positionSizeUSD,
            percentOfBudget: positionSizeUSD / this.budgetState.totalBudget,
            reasoning: `${(baseAllocation * 100).toFixed(1)}% allocation (confidence: ${(adaptiveTarget.confidence * 100).toFixed(0)}%)`,
            minVolume,
            minCost
        };
    }
    
    /**
     * Validate the trading decision for budget mode
     */
    validateBudgetDecision(pair, adaptiveTarget, positionSize) {
        const validation = {
            approved: true,
            warnings: [],
            rejectionReasons: []
        };
        
        // Check target within limits
        const pairConfig = this.pairLimits[pair];
        if (adaptiveTarget.target > pairConfig.aggressiveLimit) {
            validation.approved = false;
            validation.rejectionReasons.push(`Target ${(adaptiveTarget.target * 100).toFixed(2)}% exceeds limit ${(pairConfig.aggressiveLimit * 100).toFixed(2)}%`);
        }
        
        // Check confidence
        if (adaptiveTarget.confidence < 0.3) {
            validation.approved = false;
            validation.rejectionReasons.push(`Confidence ${(adaptiveTarget.confidence * 100).toFixed(0)}% below minimum`);
        }
        
        // Check position size
        if (positionSize.size < this.config.minTradeSize) {
            validation.approved = false;
            validation.rejectionReasons.push(`Position size $${positionSize.size.toFixed(2)} below minimum`);
        }
        
        // Check exchange minimum volume (will be adjusted later if possible)
        const minVolume = this.getMinimumVolume(pair);
        // Note: We don't reject here because we'll adjust the size later if needed in generateTradingDecision
        
        // Check total exposure
        const totalExposure = this.budgetState.usedBudget + positionSize.size;
        const exposurePercent = totalExposure / this.budgetState.totalBudget;
        if (exposurePercent > this.config.maxTotalExposurePercent) {
            validation.approved = false;
            validation.rejectionReasons.push(`Total exposure ${(exposurePercent * 100).toFixed(0)}% exceeds limit`);
        }
        
        return validation;
    }
    
    /**
     * Update available budget based on active positions
     */
    _updateAvailableBudget() {
        let usedBudget = 0;
        for (const [tradeId, position] of this.activePositions) {
            usedBudget += position.positionSize;
        }
        
        this.budgetState.usedBudget = usedBudget;
        this.budgetState.availableBudget = Math.max(0, this.budgetState.totalBudget - usedBudget);
    }
    
    /**
     * Record a new position when execution is approved
     */
    recordPosition(decision) {
        const tradeId = `${decision.pair}-${decision.timestamp}`;
        
        // Store position details
        this.activePositions.set(tradeId, {
            tradeId,
            pair: decision.pair,
            direction: decision.direction,
            entryPrice: decision.entryPrice,
            positionSize: decision.positionSize,
            exitTarget: decision.exitTarget,
            stopLoss: decision.stopLoss.price,
            entryTime: decision.timestamp,
            expectedExitTime: decision.timestamp + (decision.timeHorizon * 60 * 1000)
        });
        
        // Update pair positions tracking
        if (!this.pairPositions.has(decision.pair)) {
            this.pairPositions.set(decision.pair, new Set());
        }
        this.pairPositions.get(decision.pair).add(tradeId);
        
        // Update budget
        this._updateAvailableBudget();
    }
    
    /**
     * Remove a position when it's closed
     */
    removePosition(tradeId) {
        const position = this.activePositions.get(tradeId);
        if (!position) return;
        
        // Remove from active positions
        this.activePositions.delete(tradeId);
        
        // Remove from pair tracking
        const pairSet = this.pairPositions.get(position.pair);
        if (pairSet) {
            pairSet.delete(tradeId);
            if (pairSet.size === 0) {
                this.pairPositions.delete(position.pair);
            }
        }
        
        // Update budget
        this._updateAvailableBudget();
    }
    
    /**
     * Assess current market conditions for a specific pair
     */
    async assessMarketConditions(pair, marketConditions) {
        const pairConfig = this.pairLimits[pair];
        const assessment = {
            volatility: 'normal',
            spread: 'normal',
            volume: 'normal',
            trend: 'neutral',
            futuresSignal: 'none',
            overallCondition: 'normal',
            // Add actual values for continuous calculations
            currentVolatility: marketConditions.volatility || 0,
            currentSpread: marketConditions.spread || 0,
            currentVolume: marketConditions.volume || 0
        };
        
        // Volatility assessment (keep categorical for logging)
        const currentVol = marketConditions.volatility || 0;
        const expectedVol = this.getExpectedVolatility(pair);
        
        if (currentVol > expectedVol * 1.5) {
            assessment.volatility = 'high';
        } else if (currentVol < expectedVol * 0.7) {
            assessment.volatility = 'low';
        }
        
        // Spread assessment (keep categorical for logging)
        const currentSpread = marketConditions.spread || 0;
        if (currentSpread > pairConfig.spreadBaseline * 2) {
            assessment.spread = 'wide';
        } else if (currentSpread < pairConfig.spreadBaseline * 0.5) {
            assessment.spread = 'tight';
        }
        
        // Volume assessment
        const currentVolume = marketConditions.volume || 0;
        const expectedVolume = marketConditions.averageVolume || 1;
        
        if (currentVolume < expectedVolume * this.config.volumeThreshold) {
            assessment.volume = 'low';
        } else if (currentVolume > expectedVolume * 1.3) {
            assessment.volume = 'high';
        }
        
        // Futures signal assessment (if available)
        if (marketConditions.futuresSignal) {
            assessment.futuresSignal = marketConditions.futuresSignal.direction;
            assessment.futuresStrength = marketConditions.futuresSignal.strength;
        }
        
        // Overall condition score
        assessment.overallCondition = this.calculateOverallCondition(assessment);
        
        return assessment;
    }
    
    /**
     * Calculate overall market condition from individual assessments
     */
    calculateOverallCondition(assessment) {
        // Simple scoring system: count positive and negative factors
        let score = 0;
        
        if (assessment.volatility === 'low') score += 1;
        if (assessment.volatility === 'high') score -= 1;
        
        if (assessment.spread === 'tight') score += 1;
        if (assessment.spread === 'wide') score -= 1;
        
        if (assessment.volume === 'high') score += 1;
        if (assessment.volume === 'low') score -= 1;
        
        if (assessment.futuresSignal && assessment.futuresStrength > 0.7) score += 1;
        
        // Determine overall condition
        if (score >= 2) return 'favorable';
        if (score <= -2) return 'unfavorable';
        return 'normal';
    }
    
    /**
     * Calculate adaptive exit target based on current conditions
     */
    calculateAdaptiveExitTarget(pair, marketAssessment, signal) {
        const pairConfig = this.pairLimits[pair];
        let baseTarget = pairConfig.baselineLimit;
        let adjustmentFactors = [];
        
        // Start with baseline for the pair
        let adaptedTarget = baseTarget;
        
        // 1. Volatility adjustment using continuous modifier
        let volatilityAdjustment = 0;
        const currentVolatility = marketAssessment.currentVolatility || 0.05;
        const expectedVolatility = this.getExpectedVolatility(pair);
        const volatilityRatio = currentVolatility / expectedVolatility;
        
        // Calculate volatility modifier: ratio > 1 = higher vol, < 1 = lower vol
        // Use smooth scaling between conservative and aggressive limits
        if (volatilityRatio !== 1) {
            const range = pairConfig.aggressiveLimit - pairConfig.conservativeLimit;
            // Scale from -0.5 to +0.5 based on volatility ratio (0.5x to 2x expected)
            const volatilityModifier = Math.max(-0.5, Math.min(0.5, (volatilityRatio - 1)));
            volatilityAdjustment = range * volatilityModifier;
            
            const direction = volatilityAdjustment > 0 ? '+' : '';
            adjustmentFactors.push(`${direction}${(volatilityAdjustment * 100).toFixed(2)}% for ${volatilityRatio.toFixed(2)}x volatility`);
        }
        
        // 2. Spread adjustment using continuous modifier
        let spreadAdjustment = 0;
        const currentSpread = marketAssessment.currentSpread || pairConfig.spreadBaseline;
        const spreadRatio = currentSpread / pairConfig.spreadBaseline;
        
        // Wider spreads need higher targets to overcome costs
        // Scale adjustment based on spread ratio
        if (spreadRatio !== 1) {
            // For every 2x spread increase, add 0.1% to target
            // For every 0.5x spread decrease, subtract 0.05% from target
            const spreadModifier = Math.log2(spreadRatio) * 0.001; // 0.1% per doubling
            spreadAdjustment = Math.max(-0.001, Math.min(0.003, spreadModifier)); // Cap at ±0.3%
            
            const direction = spreadAdjustment > 0 ? '+' : '';
            adjustmentFactors.push(`${direction}${(spreadAdjustment * 100).toFixed(2)}% for ${spreadRatio.toFixed(2)}x spread`);
        }
        
        // 3. Futures signal adjustment using weighted modifier
        let futuresAdjustment = 0;
        if (signal?.futuresSignal && signal.futuresSignal.strength > 0) {
            // Scale futures signal impact based on strength (0-1)
            // Maximum adjustment is 2% of the pair's range
            const futuresWeight = 0.02; // 2% max impact
            const range = pairConfig.aggressiveLimit - pairConfig.conservativeLimit;
            futuresAdjustment = range * futuresWeight * signal.futuresSignal.strength;
            
            if (futuresAdjustment > 0.0001) { // Only show if significant
                adjustmentFactors.push(`+${(futuresAdjustment * 100).toFixed(2)}% for futures signal (${(signal.futuresSignal.strength * 100).toFixed(0)}% strength)`);
            }
        }
        
        // 4. Temporal bias adjustment using weighted modifier
        let temporalAdjustment = 0;
        if (signal?.temporalBias && Math.abs(signal.temporalBias) > 0) {
            // Scale temporal impact based on bias strength (-1 to 1)
            // Maximum adjustment is 1% of the pair's range
            const temporalWeight = 0.01; // 1% max impact
            const range = pairConfig.aggressiveLimit - pairConfig.conservativeLimit;
            temporalAdjustment = range * temporalWeight * Math.abs(signal.temporalBias);
            
            if (temporalAdjustment > 0.0001) { // Only show if significant
                adjustmentFactors.push(`+${(temporalAdjustment * 100).toFixed(2)}% for temporal bias (${(Math.abs(signal.temporalBias) * 100).toFixed(0)}% strength)`);
            }
        }
        
        // Apply all adjustments
        adaptedTarget += volatilityAdjustment + spreadAdjustment + futuresAdjustment + temporalAdjustment;
        
        // Ensure we stay within pair's viable limits
        adaptedTarget = Math.max(adaptedTarget, pairConfig.conservativeLimit);
        adaptedTarget = Math.min(adaptedTarget, pairConfig.aggressiveLimit);
        
        // Calculate expected metrics
        const expectedHoldTime = this.estimateHoldTime(pair, adaptedTarget);
        const expectedReturn = this.calculateExpectedReturn(pair, adaptedTarget);
        const confidence = this.calculateConfidence(pair, adaptedTarget, marketAssessment, signal);
        
        return {
            target: adaptedTarget,
            baseTarget,
            volatilityAdjustment,
            spreadAdjustment,
            expectedHoldTime,
            expectedReturn,
            confidence,
            factors: adjustmentFactors
        };
    }
    
    /**
     * Calculate optimal position size for the pair and target
     */
    calculateOptimalPositionSize(pair, availableCapital, adaptiveTarget) {
        const pairConfig = this.pairLimits[pair];
        
        // Base position size (percentage of available capital)
        let basePositionPercent = this.config.maxPositionSizePercent;
        
        // Adjust based on pair characteristics
        if (pairConfig.volatilityClass === 'ultra_low') {
            basePositionPercent *= 1.2; // Can allocate more to stable pairs
        } else if (pairConfig.volatilityClass === 'high') {
            basePositionPercent *= 0.8; // Reduce allocation to volatile pairs
        }
        
        // Adjust based on confidence
        basePositionPercent *= adaptiveTarget.confidence;
        
        // Ensure we don't exceed limits
        basePositionPercent = Math.min(basePositionPercent, this.config.maxPositionSizePercent);
        
        const positionSize = availableCapital * basePositionPercent;
        
        return {
            size: positionSize,
            percent: basePositionPercent,
            reasoning: `${(basePositionPercent * 100).toFixed(1)}% allocation for ${pair} (confidence: ${(adaptiveTarget.confidence * 100).toFixed(0)}%)`
        };
    }
    
    /**
     * Validate risk parameters for the trading decision
     */
    validateRiskParameters(pair, adaptiveTarget, positionSize) {
        const validation = {
            approved: true,
            warnings: [],
            rejectionReasons: []
        };
        
        // Check if target is within viable limits
        const pairConfig = this.pairLimits[pair];
        if (adaptiveTarget.target > pairConfig.aggressiveLimit) {
            validation.approved = false;
            validation.rejectionReasons.push(`Target ${(adaptiveTarget.target * 100).toFixed(2)}% exceeds aggressive limit ${(pairConfig.aggressiveLimit * 100).toFixed(2)}%`);
        }
        
        // Check confidence threshold
        if (adaptiveTarget.confidence < 0.3) {
            validation.approved = false;
            validation.rejectionReasons.push(`Confidence ${(adaptiveTarget.confidence * 100).toFixed(0)}% below minimum threshold`);
        }
        
        // Check position size
        if (positionSize.size < 10) { // Minimum $10 trade
            validation.approved = false;
            validation.rejectionReasons.push(`Position size $${positionSize.size.toFixed(2)} below minimum`);
        }
        
        // Check exchange minimum cost - must be available
        if (!this.exchangeMinimums[pair]?.minCost) {
            validation.approved = false;
            validation.rejectionReasons.push(`No exchange minimum cost data available for ${pair}`);
            return validation;
        }
        const minCost = this.exchangeMinimums[pair].minCost;
        if (positionSize.size < minCost) {
            validation.approved = false;
            validation.rejectionReasons.push(`Position size $${positionSize.size.toFixed(2)} below exchange minimum cost $${minCost}`);
        }
        
        // Check concurrent trades limit
        const activePairTrades = Object.keys(this.marketState.activeTrades).length;
        if (activePairTrades >= this.config.maxConcurrentPairs) {
            validation.approved = false;
            validation.rejectionReasons.push(`Maximum concurrent pairs (${this.config.maxConcurrentPairs}) reached`);
        }
        
        return validation;
    }
    
    /**
     * Calculate stop loss based on pair characteristics
     */
    calculateStopLoss(pair, currentPrice, direction) {
        const pairConfig = this.pairLimits[pair];
        
        // Base stop loss
        let stopLossPercent = 0.01; // 1%
        
        // Adjust based on pair volatility
        if (pairConfig.volatilityClass === 'high') {
            stopLossPercent = 0.015; // 1.5% for volatile pairs
        } else if (pairConfig.volatilityClass === 'ultra_low') {
            stopLossPercent = 0.007; // 0.7% for stable pairs
        }
        
        const stopLossPrice = direction === 'long' 
            ? currentPrice * (1 - stopLossPercent)
            : currentPrice * (1 + stopLossPercent);
            
        return {
            price: stopLossPrice,
            percent: stopLossPercent,
            reasoning: `${(stopLossPercent * 100).toFixed(1)}% stop loss for ${pairConfig.volatilityClass} volatility pair`
        };
    }
    
    /**
     * Helper functions
     */
    getExpectedVolatility(pair) {
        const volatilityMap = {
            'BTC/USD': 0.017,
            'ETH/USD': 0.058,
            'XRP/USD': 0.037,
            'ADA/USD': 0.132,
            'LINK/USD': 0.150
        };
        
        if (!volatilityMap[pair]) {
            throw new Error(`No volatility data available for ${pair}. System requires complete pair configuration and cannot use fallback values.`);
        }
        
        return volatilityMap[pair];
    }
    
    calculateOverallCondition(assessment) {
        const scores = {
            volatility: assessment.volatility === 'normal' ? 1 : (assessment.volatility === 'high' ? 0.8 : 0.6),
            spread: assessment.spread === 'normal' ? 1 : (assessment.spread === 'tight' ? 1.1 : 0.7),
            volume: assessment.volume === 'normal' ? 1 : (assessment.volume === 'high' ? 1.1 : 0.8)
        };
        
        const avgScore = (scores.volatility + scores.spread + scores.volume) / 3;
        
        if (avgScore > 1.05) return 'favorable';
        if (avgScore < 0.8) return 'unfavorable';
        return 'normal';
    }
    
    estimateHoldTime(pair, target) {
        const pairConfig = this.pairLimits[pair];
        const baseHoldTime = pairConfig.avgHoldTime;
        
        // Higher targets typically take longer
        const targetMultiplier = target / pairConfig.baselineLimit;
        return Math.round(baseHoldTime * Math.sqrt(targetMultiplier));
    }
    
    calculateExpectedReturn(pair, target) {
        const pairConfig = this.pairLimits[pair];
        
        // Base success rate for this target level
        let successRate = pairConfig.minSuccessRate;
        
        // Adjust success rate based on how aggressive the target is
        const aggressiveness = target / pairConfig.baselineLimit;
        if (aggressiveness > 1.5) {
            successRate *= 0.7; // Reduce success rate for aggressive targets
        } else if (aggressiveness < 1.1) {
            successRate *= 1.1; // Increase success rate for conservative targets
        }
        
        // Expected return = target * success rate (minus fees)
        const roundTripFee = 0.005; // 0.5% round trip
        const netTarget = Math.max(0, target - roundTripFee);
        
        return netTarget * successRate;
    }
    
    calculateConfidence(pair, target, marketAssessment, signal) {
        // Start with signal confidence if provided, otherwise use base confidence
        let confidence = (signal && signal.confidence !== undefined) ? signal.confidence : 0.7;
        
        // Adjust based on market conditions
        if (marketAssessment.overallCondition === 'favorable') {
            confidence += 0.2;
        } else if (marketAssessment.overallCondition === 'unfavorable') {
            confidence -= 0.2;
        }
        
        // Adjust based on target aggressiveness
        const pairConfig = this.pairLimits[pair];
        const aggressiveness = target / pairConfig.baselineLimit;
        if (aggressiveness > 1.3) {
            confidence -= 0.15; // Less confident in aggressive targets
        }
        
        // Adjust based on pair characteristics
        if (pairConfig.characteristics.predictability === 'high') {
            confidence += 0.1;
        }
        
        return Math.max(0.1, Math.min(1.0, confidence));
    }
    
    rejectOpportunity(pair, reason) {
        const rejection = {
            timestamp: Date.now(),
            pair,
            action: 'REJECT',
            reason,
            confidence: 0
        };
        
        // Add budget status if in budget mode
        if (this.config.useBudgetMode) {
            rejection.reasoning = {
                budgetStatus: {
                    totalBudget: this.budgetState.totalBudget,
                    usedBudget: this.budgetState.usedBudget,
                    availableBudget: this.budgetState.availableBudget
                }
            };
        }
        
        return rejection;
    }
    
    logDecision(decision) {
        this.performance.decisionHistory.push(decision);
        
        // Keep only last 1000 decisions
        if (this.performance.decisionHistory.length > 1000) {
            this.performance.decisionHistory = this.performance.decisionHistory.slice(-1000);
        }
        
        const exitTarget = decision.exitTargetPercent || 'N/A';
        const confidence = decision.confidence ? (decision.confidence * 100).toFixed(0) : '0';
        logger.info(`${decision.action} ${decision.pair} at ${exitTarget} (confidence: ${confidence}%)`);
    }
    
    /**
     * Get current status of positions and budget
     */
    getStatus() {
        const positionsByPair = {};
        for (const [pair, tradeIds] of this.pairPositions) {
            positionsByPair[pair] = tradeIds.size;
        }
        
        return {
            budget: {
                total: this.budgetState.totalBudget,
                used: this.budgetState.usedBudget,
                available: this.budgetState.availableBudget,
                utilizationPercent: (this.budgetState.usedBudget / this.budgetState.totalBudget * 100).toFixed(1)
            },
            positions: {
                total: this.activePositions.size,
                byPair: positionsByPair
            },
            lastUpdate: new Date(this.budgetState.lastUpdate).toISOString()
        };
    }
    
    /**
     * Get performance statistics
     */
    getPerformanceStats() {
        const recentDecisions = this.performance.decisionHistory.slice(-100);
        const executed = recentDecisions.filter(d => d.action === 'EXECUTE');
        const rejected = recentDecisions.filter(d => d.action === 'REJECT');
        
        // Rejection reason breakdown
        const rejectionReasons = {};
        rejected.forEach(d => {
            const reason = d.reason || 'Unknown';
            const mainReason = reason.split(':')[0]; // Get main reason category
            rejectionReasons[mainReason] = (rejectionReasons[mainReason] || 0) + 1;
        });
        
        // Calculate average position size for executed trades
        const avgPositionSize = executed.length > 0
            ? executed.reduce((sum, d) => sum + d.positionSize, 0) / executed.length
            : 0;
        
        return {
            totalDecisions: recentDecisions.length,
            executionRate: executed.length / recentDecisions.length,
            avgConfidence: executed.reduce((sum, d) => sum + d.confidence, 0) / executed.length || 0,
            avgPositionSize: avgPositionSize,
            pairDistribution: this.getPairDistribution(executed),
            avgTargetByPair: this.getAvgTargetByPair(executed),
            rejectionReasons,
            currentStatus: this.config.useBudgetMode ? this.getStatus() : null
        };
    }
    
    getPairDistribution(decisions) {
        const distribution = {};
        decisions.forEach(d => {
            distribution[d.pair] = (distribution[d.pair] || 0) + 1;
        });
        return distribution;
    }
    
    getAvgTargetByPair(decisions) {
        const targets = {};
        decisions.forEach(d => {
            if (!targets[d.pair]) targets[d.pair] = [];
            targets[d.pair].push(d.exitTarget);
        });
        
        const avgTargets = {};
        for (const [pair, targetList] of Object.entries(targets)) {
            avgTargets[pair] = (targetList.reduce((sum, t) => sum + t, 0) / targetList.length * 100).toFixed(2) + '%';
        }
        
        return avgTargets;
    }
    
    /**
     * Initialize pacing for the session
     * @private
     */
    _initializePacing(totalBudget) {
        this.pacingState.sessionStartTime = Date.now();
        this.pacingState.currentIntervalStart = Date.now();
        
        if (this.config.pacingStrategy === 'progressive') {
            // Progressive release: Start small and increase over time
            this.pacingState.releasedBudget = totalBudget * this.config.initialBudgetPercent;
            
            // Calculate release schedule
            const intervals = Math.ceil(this.config.rampUpDuration / this.config.budgetReleaseInterval);
            const remainingBudget = totalBudget - this.pacingState.releasedBudget;
            const baseRelease = remainingBudget / intervals;
            
            for (let i = 0; i < intervals; i++) {
                const multiplier = this.config.pacingStrategy === 'progressive' ? 
                    (i + 1) / intervals : // Progressive: increase each interval
                    1; // Linear: equal amounts
                    
                this.pacingState.budgetReleaseSchedule.push({
                    time: this.pacingState.sessionStartTime + (i + 1) * this.config.budgetReleaseInterval,
                    amount: baseRelease * multiplier,
                    released: false
                });
            }
        } else if (this.config.pacingStrategy === 'linear') {
            // Linear release: Equal amounts over time
            this.pacingState.releasedBudget = totalBudget * this.config.maxBudgetPerInterval;
        }
        
        logger.info('Pacing initialized:', {
            strategy: this.config.pacingStrategy,
            initialRelease: this.pacingState.releasedBudget.toFixed(2),
            totalBudget: totalBudget.toFixed(2),
            rampUpDuration: this.config.rampUpDuration / 60000 + ' minutes'
        });
    }
    
    /**
     * Check pacing constraints before allowing a trade
     * @private
     */
    _checkPacingConstraints(pair) {
        if (!this.config.enablePacing || !this.pacingState || !this.pacingState.sessionStartTime) {
            return { shouldReject: false };
        }
        
        const now = Date.now();
        
        // Check global trade frequency
        if (this.pacingState.lastTradeTime && 
            now - this.pacingState.lastTradeTime < this.config.minTimeBetweenTrades) {
            const waitTime = Math.ceil((this.config.minTimeBetweenTrades - (now - this.pacingState.lastTradeTime)) / 1000);
            return {
                shouldReject: true,
                reason: `Wait ${waitTime}s between trades`
            };
        }
        
        // Check pair-specific trade frequency
        const lastPairTrade = this.pacingState.lastTradeTimes[pair] || 0;
        if (lastPairTrade && now - lastPairTrade < this.config.minTimeBetweenPairTrades) {
            const waitTime = Math.ceil((this.config.minTimeBetweenPairTrades - (now - lastPairTrade)) / 1000);
            return {
                shouldReject: true,
                reason: `Wait ${waitTime}s before trading ${pair} again`
            };
        }
        
        // Check interval trade limit
        if (now - this.pacingState.currentIntervalStart > this.config.budgetReleaseInterval) {
            // Reset interval
            this.pacingState.currentIntervalStart = now;
            this.pacingState.tradesInInterval = 0;
        }
        
        return { shouldReject: false };
    }
    
    /**
     * Get effective budget considering pacing restrictions
     * @private
     */
    _getEffectiveBudgetWithPacing() {
        if (!this.config.enablePacing || !this.pacingState || !this.pacingState.sessionStartTime) {
            return this.budgetState.totalBudget;
        }
        
        const now = Date.now();
        
        // Process any pending budget releases
        if (this.config.pacingStrategy === 'progressive') {
            for (const release of this.pacingState.budgetReleaseSchedule) {
                if (!release.released && now >= release.time) {
                    this.pacingState.releasedBudget += release.amount;
                    release.released = true;
                    logger.info(`Released additional budget: $${release.amount.toFixed(2)} (total: $${this.pacingState.releasedBudget.toFixed(2)})`);
                }
            }
        } else if (this.config.pacingStrategy === 'linear') {
            // Linear release based on time elapsed
            const elapsed = now - this.pacingState.sessionStartTime;
            const progress = Math.min(1, elapsed / this.config.rampUpDuration);
            this.pacingState.releasedBudget = this.budgetState.totalBudget * progress;
        } else if (this.config.pacingStrategy === 'adaptive') {
            // Adaptive release based on success rate and market conditions
            const successRate = this._calculateRecentSuccessRate();
            const baseRelease = this.budgetState.totalBudget * this.config.initialBudgetPercent;
            const bonusRelease = this.budgetState.totalBudget * (1 - this.config.initialBudgetPercent) * successRate;
            this.pacingState.releasedBudget = Math.min(this.budgetState.totalBudget, baseRelease + bonusRelease);
        }
        
        return Math.min(this.budgetState.totalBudget, this.pacingState.releasedBudget);
    }
    
    /**
     * Update pacing state after a trade execution
     * @private
     */
    _updatePacingAfterTrade(pair, tradeSize) {
        if (!this.pacingState) return;
        
        const now = Date.now();
        this.pacingState.lastTradeTime = now;
        this.pacingState.lastTradeTimes[pair] = now;
        this.pacingState.tradesInInterval++;
        this.pacingState.totalTradesExecuted++;
    }
    
    /**
     * Calculate recent success rate for adaptive pacing
     * @private
     */
    _calculateRecentSuccessRate() {
        const recentDecisions = this.performance.decisionHistory.slice(-20);
        if (recentDecisions.length === 0) return 0.5; // Default 50%
        
        const executed = recentDecisions.filter(d => d.action === 'EXECUTE').length;
        return executed / recentDecisions.length;
    }
}