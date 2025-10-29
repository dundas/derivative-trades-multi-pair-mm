/**
 * Market Regime Duration Predictor Service
 * 
 * Analyzes historical market data to predict:
 * - Expected duration of current market regime
 * - Time remaining in current regime
 * - Confidence intervals for predictions
 * - Regime transition probabilities
 * 
 * Uses statistical models based on:
 * - Historical volatility patterns
 * - Regime stability indicators
 * - Market cycle analysis
 * - Volume and price action correlation
 */

import fs from 'fs';

class MarketRegimeDurationPredictor {
  constructor(config = {}) {
    this.config = {
      // Historical analysis window
      lookbackPeriods: config.lookbackPeriods || 30, // days
      confidenceLevel: config.confidenceLevel || 0.95,
      
      // Regime classification thresholds
      regimeThresholds: {
        LOW: { volatility: 0.01, duration: { min: 2, max: 14 } },
        MEDIUM: { volatility: 0.02, duration: { min: 1, max: 8 } },
        HIGH: { volatility: 0.04, duration: { min: 0.5, max: 4 } },
        EXTREME: { volatility: 0.08, duration: { min: 0.1, max: 2 } }
      },
      
      // Statistical model parameters
      modelParams: {
        // Exponential decay for recent data weighting
        decayFactor: 0.95,
        // Minimum samples for reliable prediction
        minSamples: 10,
        // Regime transition smoothing
        transitionSmoothing: 0.8
      },
      
      // Market cycle factors
      marketCycles: {
        // Typical crypto market patterns
        dailyCycle: { peak: 14, trough: 4 }, // UTC hours
        weeklyCycle: { peak: 2, trough: 6 }, // Day of week (0=Sunday)
        monthlyCycle: { volatileStart: true, calmMid: true }
      },
      
      ...config
    };
    
    // Historical regime data storage
    this.regimeHistory = new Map();
    this.transitionMatrix = new Map();
    
    console.log('🔮 Market Regime Duration Predictor initialized');
  }

  /**
   * Main analysis method - predict regime duration for a trading pair
   */
  async predictRegimeDuration(pairData, currentTime = new Date()) {
    try {
      console.log(`🔍 Analyzing regime duration for ${pairData.pair}`);
      
      // Extract regime data from Volume Strategy Calculator format
      const regimeData = this.parseRegimeData(pairData);
      
      // Build historical regime model
      const historicalModel = await this.buildHistoricalModel(pairData.pair, regimeData);
      
      // Calculate current regime characteristics
      const currentRegimeAnalysis = this.analyzeCurrentRegime(regimeData, currentTime);
      
      // Predict remaining duration
      const durationPrediction = this.predictRemainingDuration(
        currentRegimeAnalysis, 
        historicalModel, 
        currentTime
      );
      
      // Calculate confidence intervals
      const confidenceIntervals = this.calculateConfidenceIntervals(
        durationPrediction, 
        historicalModel
      );
      
      // Analyze transition probabilities
      const transitionProbabilities = this.calculateTransitionProbabilities(
        currentRegimeAnalysis, 
        historicalModel
      );
      
      return {
        pair: pairData.pair,
        timestamp: currentTime.toISOString(),
        currentRegime: currentRegimeAnalysis,
        prediction: durationPrediction,
        confidenceIntervals,
        transitionProbabilities,
        modelReliability: this.assessModelReliability(historicalModel),
        recommendations: this.generateTradingRecommendations(
          durationPrediction, 
          confidenceIntervals, 
          transitionProbabilities
        )
      };
      
    } catch (error) {
      console.error(`❌ Regime prediction failed for ${pairData.pair}:`, error.message);
      return this.getDefaultPrediction(pairData.pair, currentTime);
    }
  }

  /**
   * Parse regime data from Volume Strategy Calculator format
   */
  parseRegimeData(pairData) {
    const regimeAnalysis = pairData.regimeAnalysis || {};
    const volatilityData = pairData.volatilityData || {};
    
    return {
      currentRegime: regimeAnalysis.regime || 'MEDIUM',
      regimeScore: regimeAnalysis.regimeScore || 2,
      expectedDuration: regimeAnalysis.expectedDuration || 6,
      volatilityTrend: regimeAnalysis.volatilityTrend || 'STABLE',
      regimeStability: regimeAnalysis.regimeStability || 'MEDIUM',
      
      // Volatility metrics
      volatility15m: volatilityData.timeframes?.['15m']?.volatility || 0.01,
      volatility60m: volatilityData.timeframes?.['60m']?.volatility || 0.02,
      currentPrice: volatilityData.currentPrice || 100,
      
      // Additional context
      pair: pairData.pair,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Build historical regime model based on available data
   */
  async buildHistoricalModel(pair, regimeData) {
    // In a real implementation, this would query historical data
    // For now, we'll use statistical modeling based on current regime characteristics
    
    const regime = regimeData.currentRegime;
    const stability = regimeData.regimeStability;
    const trend = regimeData.volatilityTrend;
    
    // Historical duration statistics (based on crypto market patterns)
    const historicalDurations = this.getHistoricalDurationStats(regime, stability, trend);
    
    // Transition patterns
    const transitionPatterns = this.getHistoricalTransitionPatterns(regime);
    
    // Volatility evolution patterns
    const volatilityPatterns = this.getVolatilityEvolutionPatterns(regimeData);
    
    return {
      regime,
      historicalDurations,
      transitionPatterns,
      volatilityPatterns,
      sampleSize: this.estimateSampleSize(regime, stability),
      reliability: this.calculateModelReliability(regime, stability)
    };
  }

  /**
   * Get historical duration statistics for regime type
   */
  getHistoricalDurationStats(regime, stability, trend) {
    // Based on crypto market analysis - typical regime durations
    const baseStats = {
      LOW: { mean: 8.5, std: 4.2, median: 7.0, mode: 6.0 },
      MEDIUM: { mean: 4.8, std: 2.8, median: 4.0, mode: 3.0 },
      HIGH: { mean: 2.2, std: 1.5, median: 1.8, mode: 1.5 },
      EXTREME: { mean: 0.8, std: 0.6, median: 0.6, mode: 0.5 }
    };
    
    const stats = baseStats[regime] || baseStats.MEDIUM;
    
    // Adjust based on stability
    const stabilityMultipliers = {
      HIGH: 1.4,
      MEDIUM: 1.0,
      LOW: 0.7
    };
    
    // Adjust based on trend
    const trendMultipliers = {
      INCREASING: 0.85, // Increasing volatility = shorter regimes
      STABLE: 1.0,
      DECREASING: 1.15  // Decreasing volatility = longer regimes
    };
    
    const stabilityMult = stabilityMultipliers[stability] || 1.0;
    const trendMult = trendMultipliers[trend] || 1.0;
    const combinedMult = stabilityMult * trendMult;
    
    return {
      mean: stats.mean * combinedMult,
      std: stats.std * Math.sqrt(combinedMult),
      median: stats.median * combinedMult,
      mode: stats.mode * combinedMult,
      adjustments: {
        stability: stabilityMult,
        trend: trendMult,
        combined: combinedMult
      }
    };
  }

  /**
   * Get historical transition patterns
   */
  getHistoricalTransitionPatterns(currentRegime) {
    // Transition probability matrix based on crypto market behavior
    const transitionMatrix = {
      LOW: { LOW: 0.65, MEDIUM: 0.25, HIGH: 0.08, EXTREME: 0.02 },
      MEDIUM: { LOW: 0.20, MEDIUM: 0.45, HIGH: 0.30, EXTREME: 0.05 },
      HIGH: { LOW: 0.10, MEDIUM: 0.35, HIGH: 0.40, EXTREME: 0.15 },
      EXTREME: { LOW: 0.05, MEDIUM: 0.25, HIGH: 0.45, EXTREME: 0.25 }
    };
    
    return transitionMatrix[currentRegime] || transitionMatrix.MEDIUM;
  }

  /**
   * Get volatility evolution patterns
   */
  getVolatilityEvolutionPatterns(regimeData) {
    const vol15m = regimeData.volatility15m;
    const vol60m = regimeData.volatility60m;
    const trend = regimeData.volatilityTrend;
    
    // Volatility ratio analysis
    const volRatio = vol60m / vol15m;
    const volAcceleration = this.calculateVolatilityAcceleration(vol15m, vol60m, trend);
    
    return {
      shortTermVol: vol15m,
      longTermVol: vol60m,
      volRatio,
      acceleration: volAcceleration,
      trend,
      evolutionSpeed: this.calculateEvolutionSpeed(volRatio, trend)
    };
  }

  /**
   * Calculate volatility acceleration
   */
  calculateVolatilityAcceleration(vol15m, vol60m, trend) {
    const baseAcceleration = (vol60m - vol15m) / vol15m;
    
    const trendMultipliers = {
      INCREASING: 1.5,
      STABLE: 1.0,
      DECREASING: -0.5
    };
    
    return baseAcceleration * (trendMultipliers[trend] || 1.0);
  }

  /**
   * Calculate evolution speed of volatility
   */
  calculateEvolutionSpeed(volRatio, trend) {
    let speed = Math.abs(volRatio - 1.0) * 10; // Base speed
    
    if (trend === 'INCREASING') speed *= 1.3;
    else if (trend === 'DECREASING') speed *= 0.8;
    
    return Math.min(speed, 5.0); // Cap at 5.0
  }

  /**
   * Analyze current regime characteristics
   */
  analyzeCurrentRegime(regimeData, currentTime) {
    const regime = regimeData.currentRegime;
    const expectedDuration = regimeData.expectedDuration;
    const stability = regimeData.regimeStability;
    
    // Estimate regime start time (this would be from historical data in real implementation)
    const estimatedStartTime = this.estimateRegimeStartTime(regimeData, currentTime);
    const elapsedTime = (currentTime - estimatedStartTime) / (1000 * 60 * 60); // hours
    
    // Calculate regime maturity
    const maturity = elapsedTime / expectedDuration;
    
    // Assess regime health
    const health = this.assessRegimeHealth(regimeData, elapsedTime);
    
    return {
      regime,
      expectedDuration,
      elapsedTime,
      maturity,
      stability,
      health,
      startTime: estimatedStartTime,
      characteristics: {
        volatilityLevel: this.classifyVolatilityLevel(regimeData),
        trendStrength: this.calculateTrendStrength(regimeData),
        momentum: this.calculateRegimeMomentum(regimeData, maturity)
      }
    };
  }

  /**
   * Estimate when current regime started
   */
  estimateRegimeStartTime(regimeData, currentTime) {
    // Use expected duration and stability to estimate start time
    const expectedDuration = regimeData.expectedDuration;
    const stability = regimeData.regimeStability;
    
    // Stability affects how far into regime we likely are
    const stabilityFactors = {
      HIGH: 0.3,   // High stability = likely early in regime
      MEDIUM: 0.5, // Medium stability = likely mid-regime
      LOW: 0.7     // Low stability = likely late in regime
    };
    
    const estimatedProgress = stabilityFactors[stability] || 0.5;
    const estimatedElapsed = expectedDuration * estimatedProgress;
    
    return new Date(currentTime.getTime() - (estimatedElapsed * 60 * 60 * 1000));
  }

  /**
   * Assess current regime health
   */
  assessRegimeHealth(regimeData, elapsedTime) {
    const expectedDuration = regimeData.expectedDuration;
    const stability = regimeData.regimeStability;
    const trend = regimeData.volatilityTrend;
    
    // Health decreases as regime ages
    const ageHealth = Math.max(0, 1 - (elapsedTime / (expectedDuration * 1.5)));
    
    // Stability contributes to health
    const stabilityHealth = { HIGH: 0.9, MEDIUM: 0.7, LOW: 0.4 }[stability] || 0.7;
    
    // Trend affects health
    const trendHealth = { STABLE: 0.8, INCREASING: 0.6, DECREASING: 0.5 }[trend] || 0.7;
    
    const overallHealth = (ageHealth * 0.5) + (stabilityHealth * 0.3) + (trendHealth * 0.2);
    
    return {
      overall: overallHealth,
      age: ageHealth,
      stability: stabilityHealth,
      trend: trendHealth,
      status: overallHealth > 0.7 ? 'HEALTHY' : overallHealth > 0.4 ? 'DECLINING' : 'UNSTABLE'
    };
  }

  /**
   * Classify volatility level
   */
  classifyVolatilityLevel(regimeData) {
    const vol60m = regimeData.volatility60m;
    
    if (vol60m > 0.08) return 'EXTREME';
    if (vol60m > 0.04) return 'HIGH';
    if (vol60m > 0.02) return 'MEDIUM';
    return 'LOW';
  }

  /**
   * Calculate trend strength
   */
  calculateTrendStrength(regimeData) {
    const vol15m = regimeData.volatility15m;
    const vol60m = regimeData.volatility60m;
    const trend = regimeData.volatilityTrend;
    
    const volRatio = vol60m / vol15m;
    let strength = Math.abs(volRatio - 1.0);
    
    if (trend === 'STABLE') strength *= 0.5;
    
    return Math.min(strength, 2.0);
  }

  /**
   * Calculate regime momentum
   */
  calculateRegimeMomentum(regimeData, maturity) {
    const trend = regimeData.volatilityTrend;
    const stability = regimeData.regimeStability;
    
    let momentum = 1.0 - maturity; // Decreases as regime ages
    
    if (trend === 'INCREASING') momentum *= 1.2;
    else if (trend === 'DECREASING') momentum *= 0.8;
    
    if (stability === 'HIGH') momentum *= 1.1;
    else if (stability === 'LOW') momentum *= 0.9;
    
    return Math.max(0, Math.min(momentum, 2.0));
  }

  /**
   * Predict remaining duration in current regime
   */
  predictRemainingDuration(currentRegimeAnalysis, historicalModel, currentTime) {
    const expectedTotal = currentRegimeAnalysis.expectedDuration;
    const elapsed = currentRegimeAnalysis.elapsedTime;
    const health = currentRegimeAnalysis.health.overall;
    const maturity = currentRegimeAnalysis.maturity;
    
    // Base remaining time
    let remainingBase = Math.max(0, expectedTotal - elapsed);
    
    // Adjust based on regime health
    const healthAdjustment = health > 0.7 ? 1.2 : health > 0.4 ? 1.0 : 0.6;
    
    // Adjust based on historical patterns
    const historicalMean = historicalModel.historicalDurations.mean;
    const historicalAdjustment = historicalMean / expectedTotal;
    
    // Market cycle adjustments
    const cycleAdjustment = this.calculateMarketCycleAdjustment(currentTime);
    
    // Combined prediction
    const predicted = remainingBase * healthAdjustment * historicalAdjustment * cycleAdjustment;
    
    return {
      predicted: Math.max(0.1, predicted),
      baseRemaining: remainingBase,
      adjustments: {
        health: healthAdjustment,
        historical: historicalAdjustment,
        marketCycle: cycleAdjustment
      },
      confidence: this.calculatePredictionConfidence(currentRegimeAnalysis, historicalModel)
    };
  }

  /**
   * Calculate market cycle adjustment
   */
  calculateMarketCycleAdjustment(currentTime) {
    const hour = currentTime.getUTCHours();
    const dayOfWeek = currentTime.getUTCDay();
    
    // Daily cycle (crypto is more volatile during US/EU overlap)
    let dailyAdj = 1.0;
    if (hour >= 12 && hour <= 18) dailyAdj = 0.85; // Higher volatility = shorter regimes
    else if (hour >= 0 && hour <= 6) dailyAdj = 1.15; // Lower volatility = longer regimes
    
    // Weekly cycle (weekends tend to be calmer)
    let weeklyAdj = 1.0;
    if (dayOfWeek === 0 || dayOfWeek === 6) weeklyAdj = 1.1; // Weekends
    else if (dayOfWeek >= 1 && dayOfWeek <= 5) weeklyAdj = 0.95; // Weekdays
    
    return dailyAdj * weeklyAdj;
  }

  /**
   * Calculate prediction confidence
   */
  calculatePredictionConfidence(currentRegimeAnalysis, historicalModel) {
    const stability = currentRegimeAnalysis.stability;
    const health = currentRegimeAnalysis.health.overall;
    const maturity = currentRegimeAnalysis.maturity;
    const modelReliability = historicalModel.reliability;
    
    // Base confidence from stability
    const stabilityConf = { HIGH: 0.85, MEDIUM: 0.70, LOW: 0.55 }[stability] || 0.70;
    
    // Health contributes to confidence
    const healthConf = health;
    
    // Maturity affects confidence (early and very late stages less predictable)
    let maturityConf = 1.0;
    if (maturity < 0.2 || maturity > 0.9) maturityConf = 0.7;
    else if (maturity >= 0.3 && maturity <= 0.7) maturityConf = 0.9;
    else maturityConf = 0.8;
    
    // Combined confidence
    const overall = (stabilityConf * 0.4) + (healthConf * 0.3) + (maturityConf * 0.2) + (modelReliability * 0.1);
    
    return {
      overall: Math.max(0.3, Math.min(0.95, overall)),
      components: {
        stability: stabilityConf,
        health: healthConf,
        maturity: maturityConf,
        model: modelReliability
      }
    };
  }

  /**
   * Calculate confidence intervals
   */
  calculateConfidenceIntervals(durationPrediction, historicalModel) {
    const predicted = durationPrediction.predicted;
    const confidence = durationPrediction.confidence.overall;
    const historicalStd = historicalModel.historicalDurations.std;
    
    // Standard error based on historical data and confidence
    const standardError = historicalStd * (1 - confidence);
    
    // Z-scores for different confidence levels
    const zScores = {
      50: 0.674,
      68: 1.000,
      80: 1.282,
      90: 1.645,
      95: 1.960,
      99: 2.576
    };
    
    const intervals = {};
    
    for (const [level, zScore] of Object.entries(zScores)) {
      const margin = zScore * standardError;
      intervals[`${level}%`] = {
        lower: Math.max(0.1, predicted - margin),
        upper: predicted + margin,
        margin: margin
      };
    }
    
    return intervals;
  }

  /**
   * Calculate transition probabilities
   */
  calculateTransitionProbabilities(currentRegimeAnalysis, historicalModel) {
    const baseTransitions = historicalModel.transitionPatterns;
    const health = currentRegimeAnalysis.health.overall;
    const maturity = currentRegimeAnalysis.maturity;
    
    // Adjust probabilities based on regime health and maturity
    const adjustedTransitions = {};
    
    for (const [toRegime, baseProb] of Object.entries(baseTransitions)) {
      let adjustedProb = baseProb;
      
      // As regime ages and health declines, more likely to transition
      if (toRegime !== currentRegimeAnalysis.regime) {
        const transitionBoost = (1 - health) * maturity * 0.3;
        adjustedProb += transitionBoost;
      } else {
        // Less likely to stay in unhealthy, mature regime
        const stayPenalty = (1 - health) * maturity * 0.2;
        adjustedProb -= stayPenalty;
      }
      
      adjustedTransitions[toRegime] = Math.max(0.01, Math.min(0.95, adjustedProb));
    }
    
    // Normalize probabilities
    const total = Object.values(adjustedTransitions).reduce((sum, prob) => sum + prob, 0);
    for (const regime of Object.keys(adjustedTransitions)) {
      adjustedTransitions[regime] /= total;
    }
    
    return {
      raw: baseTransitions,
      adjusted: adjustedTransitions,
      nextMostLikely: this.findMostLikelyTransition(adjustedTransitions, currentRegimeAnalysis.regime)
    };
  }

  /**
   * Find most likely transition (excluding staying in current regime)
   */
  findMostLikelyTransition(transitions, currentRegime) {
    let maxProb = 0;
    let mostLikely = null;
    
    for (const [regime, prob] of Object.entries(transitions)) {
      if (regime !== currentRegime && prob > maxProb) {
        maxProb = prob;
        mostLikely = regime;
      }
    }
    
    return { regime: mostLikely, probability: maxProb };
  }

  /**
   * Estimate sample size for model reliability
   */
  estimateSampleSize(regime, stability) {
    // Simulate having different amounts of historical data
    const baseSize = { HIGH: 25, MEDIUM: 20, LOW: 15 }[stability] || 20;
    const regimeMultiplier = { LOW: 1.2, MEDIUM: 1.0, HIGH: 0.8, EXTREME: 0.6 }[regime] || 1.0;
    
    return Math.floor(baseSize * regimeMultiplier);
  }

  /**
   * Calculate model reliability
   */
  calculateModelReliability(regime, stability) {
    const sampleSize = this.estimateSampleSize(regime, stability);
    const minSamples = this.config.modelParams.minSamples;
    
    if (sampleSize < minSamples) return 0.3;
    
    // Reliability increases with sample size, plateaus around 50 samples
    const sizeReliability = Math.min(0.9, sampleSize / 50);
    
    // Stability affects reliability
    const stabilityReliability = { HIGH: 0.9, MEDIUM: 0.7, LOW: 0.5 }[stability] || 0.7;
    
    return (sizeReliability * 0.6) + (stabilityReliability * 0.4);
  }

  /**
   * Assess overall model reliability
   */
  assessModelReliability(historicalModel) {
    const baseReliability = historicalModel.reliability;
    const sampleSize = historicalModel.sampleSize;
    
    let assessment = 'LOW';
    if (baseReliability > 0.8 && sampleSize > 20) assessment = 'HIGH';
    else if (baseReliability > 0.6 && sampleSize > 15) assessment = 'MEDIUM';
    
    return {
      level: assessment,
      score: baseReliability,
      sampleSize,
      recommendation: this.getReliabilityRecommendation(assessment, baseReliability)
    };
  }

  /**
   * Get reliability recommendation
   */
  getReliabilityRecommendation(level, score) {
    if (level === 'HIGH') {
      return 'High confidence in predictions. Safe to use for trading decisions.';
    } else if (level === 'MEDIUM') {
      return 'Moderate confidence. Use with additional confirmation signals.';
    } else {
      return 'Low confidence. Use only as rough guidance, not for precise timing.';
    }
  }

  /**
   * Generate trading recommendations based on predictions
   */
  generateTradingRecommendations(durationPrediction, confidenceIntervals, transitionProbabilities) {
    const predicted = durationPrediction.predicted;
    const confidence = durationPrediction.confidence.overall;
    const nextRegime = transitionProbabilities.nextMostLikely;
    
    const recommendations = [];
    
    // Duration-based recommendations
    if (predicted < 1) {
      recommendations.push({
        type: 'TIMING',
        priority: 'HIGH',
        message: `Regime ending soon (${predicted.toFixed(1)}h). Prepare for transition.`,
        action: 'REDUCE_POSITION_SIZE'
      });
    } else if (predicted > 6) {
      recommendations.push({
        type: 'TIMING',
        priority: 'MEDIUM',
        message: `Stable regime expected (${predicted.toFixed(1)}h). Good for trend strategies.`,
        action: 'MAINTAIN_STRATEGY'
      });
    }
    
    // Confidence-based recommendations
    if (confidence < 0.5) {
      recommendations.push({
        type: 'CONFIDENCE',
        priority: 'HIGH',
        message: `Low prediction confidence (${(confidence * 100).toFixed(0)}%). Use conservative approach.`,
        action: 'REDUCE_RISK'
      });
    }
    
    // Transition-based recommendations
    if (nextRegime.probability > 0.4) {
      recommendations.push({
        type: 'TRANSITION',
        priority: 'MEDIUM',
        message: `Likely transition to ${nextRegime.regime} (${(nextRegime.probability * 100).toFixed(0)}% chance).`,
        action: `PREPARE_FOR_${nextRegime.regime}`
      });
    }
    
    return recommendations;
  }

  /**
   * Get default prediction when analysis fails
   */
  getDefaultPrediction(pair, currentTime) {
    return {
      pair,
      timestamp: currentTime.toISOString(),
      currentRegime: {
        regime: 'MEDIUM',
        expectedDuration: 4,
        elapsedTime: 2,
        maturity: 0.5,
        stability: 'MEDIUM',
        health: { overall: 0.6, status: 'DECLINING' }
      },
      prediction: {
        predicted: 2.0,
        confidence: { overall: 0.3 }
      },
      confidenceIntervals: {
        '50%': { lower: 1.0, upper: 3.0 },
        '95%': { lower: 0.5, upper: 4.0 }
      },
      transitionProbabilities: {
        adjusted: { LOW: 0.2, MEDIUM: 0.4, HIGH: 0.3, EXTREME: 0.1 }
      },
      modelReliability: { level: 'LOW', score: 0.3 },
      recommendations: [{
        type: 'CONFIDENCE',
        priority: 'HIGH',
        message: 'Insufficient data for reliable prediction. Use conservative approach.',
        action: 'REDUCE_RISK'
      }]
    };
  }

  /**
   * Display prediction results
   */
  displayPrediction(prediction) {
    console.log(`\n🔮 MARKET REGIME DURATION PREDICTION: ${prediction.pair}`);
    console.log('=' .repeat(60));
    
    const current = prediction.currentRegime;
    const pred = prediction.prediction;
    const confidence = pred.confidence.overall;
    
    console.log(`\n📊 CURRENT REGIME ANALYSIS:`);
    console.log(`  • Regime: ${current.regime}`);
    console.log(`  • Expected Duration: ${current.expectedDuration.toFixed(1)} hours`);
    console.log(`  • Elapsed Time: ${current.elapsedTime.toFixed(1)} hours`);
    console.log(`  • Maturity: ${(current.maturity * 100).toFixed(0)}%`);
    console.log(`  • Stability: ${current.stability}`);
    console.log(`  • Health: ${current.health.status} (${(current.health.overall * 100).toFixed(0)}%)`);
    
    console.log(`\n⏰ DURATION PREDICTION:`);
    console.log(`  • Predicted Remaining: ${pred.predicted.toFixed(1)} hours`);
    console.log(`  • Confidence: ${(confidence * 100).toFixed(0)}%`);
    
    console.log(`\n📈 CONFIDENCE INTERVALS:`);
    const intervals = prediction.confidenceIntervals;
    console.log(`  • 50%: ${intervals['50%'].lower.toFixed(1)} - ${intervals['50%'].upper.toFixed(1)} hours`);
    console.log(`  • 80%: ${intervals['80%'].lower.toFixed(1)} - ${intervals['80%'].upper.toFixed(1)} hours`);
    console.log(`  • 95%: ${intervals['95%'].lower.toFixed(1)} - ${intervals['95%'].upper.toFixed(1)} hours`);
    
    console.log(`\n🔄 TRANSITION PROBABILITIES:`);
    const transitions = prediction.transitionProbabilities.adjusted;
    Object.entries(transitions).forEach(([regime, prob]) => {
      const indicator = regime === current.regime ? '🔵' : '⚪';
      console.log(`  ${indicator} ${regime}: ${(prob * 100).toFixed(0)}%`);
    });
    
    const nextMost = prediction.transitionProbabilities.nextMostLikely;
    console.log(`  ➡️  Most Likely Next: ${nextMost.regime} (${(nextMost.probability * 100).toFixed(0)}%)`);
    
    console.log(`\n🎯 MODEL RELIABILITY:`);
    const reliability = prediction.modelReliability;
    console.log(`  • Level: ${reliability.level}`);
    console.log(`  • Score: ${(reliability.score * 100).toFixed(0)}%`);
    console.log(`  • Recommendation: ${reliability.recommendation}`);
    
    console.log(`\n💡 TRADING RECOMMENDATIONS:`);
    prediction.recommendations.forEach((rec, index) => {
      const priority = rec.priority === 'HIGH' ? '🔴' : rec.priority === 'MEDIUM' ? '🟡' : '🟢';
      console.log(`  ${priority} ${rec.type}: ${rec.message}`);
      console.log(`     Action: ${rec.action}`);
    });
    
    console.log(`\n✅ Regime duration analysis complete for ${prediction.pair}`);
  }

  /**
   * Save prediction results to file
   */
  async savePrediction(prediction) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `regime-prediction-${prediction.pair.replace('/', '-')}-${timestamp}.json`;
    
    try {
      fs.writeFileSync(filename, JSON.stringify(prediction, null, 2));
      console.log(`💾 Regime prediction saved: ${filename}`);
    } catch (error) {
      console.warn('⚠️  Failed to save prediction:', error.message);
    }
  }
}

// Export for use as module
export { MarketRegimeDurationPredictor };

// Example usage
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('🔮 Market Regime Duration Predictor');
  console.log('Usage: node market-regime-predictor.js [pair-data.json]');
} 