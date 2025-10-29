/**
 * OpportunityRankingEngine
 * 
 * Ranks trading opportunities based on multiple factors including:
 * - Signal strength from futures lead
 * - Timing (how fresh the signal is)
 * - Spread opportunity
 * - Liquidity available
 * - Correlation with existing positions
 * - Historical performance
 */

export class OpportunityRankingEngine {
  constructor(options = {}) {
    this.logger = options.logger;
    
    // Configurable weights for scoring
    this.weights = {
      signalStrength: 0.30,
      timing: 0.25,
      spread: 0.15,
      liquidity: 0.10,
      correlation: 0.10,
      historical: 0.10,
      ...options.weights
    };
    
    // Validate weights sum to 1
    const totalWeight = Object.values(this.weights).reduce((sum, w) => sum + w, 0);
    if (Math.abs(totalWeight - 1.0) > 0.01) {
      this.logger?.warn('Weights do not sum to 1.0', { totalWeight, weights: this.weights });
    }
  }
  
  /**
   * Rank opportunities based on multiple factors
   * @param {Array} opportunities - Array of opportunity objects
   * @param {Object} portfolio - Current portfolio state
   * @returns {Array} Ranked opportunities with scores
   */
  async rank(opportunities, portfolio) {
    if (!opportunities || opportunities.length === 0) {
      return [];
    }
    
    // Score each opportunity
    const scoredOpportunities = opportunities.map(opp => {
      const scores = {
        signalStrength: this._scoreSignalStrength(opp),
        timing: this._scoreTimingWindow(opp),
        spread: this._scoreSpreadOpportunity(opp),
        liquidity: this._scoreLiquidity(opp),
        correlation: this._scoreCorrelation(opp, portfolio),
        historical: this._scoreHistoricalPerformance(opp, portfolio)
      };
      
      const finalScore = this._calculateWeightedScore(scores);
      
      return {
        ...opp,
        scores,
        finalScore
      };
    });
    
    // Sort by final score descending
    return scoredOpportunities.sort((a, b) => b.finalScore - a.finalScore);
  }
  
  /**
   * Score signal strength (0-100)
   * @private
   */
  _scoreSignalStrength(opportunity) {
    const movement = Math.abs(opportunity.signal.futuresMovement);
    
    // Scale: 0.05% = 50, 0.1% = 70, 0.5% = 90, 1%+ = 100
    if (movement >= 1.0) return 100;
    if (movement >= 0.5) return 90;
    if (movement >= 0.1) return 70;
    if (movement >= 0.05) return 50;
    
    return movement * 1000; // Linear scale below 0.05%
  }
  
  /**
   * Score timing window (0-100)
   * @private
   */
  _scoreTimingWindow(opportunity) {
    const age = Date.now() - opportunity.timestamp;
    const expectedLead = opportunity.leadTimeExpected || 3000;
    
    // Perfect timing: 1-2 seconds after detection
    if (age >= 1000 && age <= 2000) return 100;
    
    // Good timing: within expected lead window
    if (age <= expectedLead) return 80;
    
    // Degrading score as signal ages
    const decayRate = 100 / expectedLead; // Points lost per ms
    return Math.max(0, 100 - (age * decayRate));
  }
  
  /**
   * Score spread opportunity (0-100)
   * @private
   */
  _scoreSpreadOpportunity(opportunity) {
    const spread = Math.abs(opportunity.signal.spread);
    
    // Ideal spread: 0.1-0.3%
    if (spread >= 0.1 && spread <= 0.3) return 100;
    
    // Good spread: 0.05-0.1% or 0.3-0.5%
    if ((spread >= 0.05 && spread < 0.1) || (spread > 0.3 && spread <= 0.5)) return 80;
    
    // Moderate spread
    if (spread >= 0.02 && spread < 0.05) return 60;
    
    // Low spread
    return Math.max(0, spread * 2000); // Linear scale
  }
  
  /**
   * Score liquidity (0-100)
   * @private
   */
  _scoreLiquidity(opportunity) {
    const liquidity = opportunity.marketData?.spotLiquidity || 0;
    
    // Scale based on USD liquidity
    if (liquidity >= 100000) return 100; // $100k+
    if (liquidity >= 50000) return 90;   // $50k+
    if (liquidity >= 20000) return 80;   // $20k+
    if (liquidity >= 10000) return 70;   // $10k+
    if (liquidity >= 5000) return 60;    // $5k+
    
    return (liquidity / 5000) * 60; // Linear scale below $5k
  }
  
  /**
   * Score correlation with existing positions (0-100)
   * Higher score = lower correlation (more diversification)
   * @private
   */
  _scoreCorrelation(opportunity, portfolio) {
    // If no existing positions, maximum diversification benefit
    if (!portfolio.positions || Object.keys(portfolio.positions).length === 0) {
      return 100;
    }
    
    // Check if we already have a position in this pair
    if (portfolio.positions[opportunity.pair]) {
      return 20; // Low score for adding to existing position
    }
    
    // For now, simple scoring - can be enhanced with actual correlation data
    return 80;
  }
  
  /**
   * Score based on historical performance (0-100)
   * @private
   */
  _scoreHistoricalPerformance(opportunity, portfolio) {
    // Check pair performance history
    const pairPerf = portfolio.pairPerformance?.[opportunity.pair];
    
    if (!pairPerf || pairPerf.totalTrades === 0) {
      return 50; // Neutral score for no history
    }
    
    // Score based on win rate
    const winRate = pairPerf.winRate || 0;
    return winRate * 100;
  }
  
  /**
   * Calculate weighted final score
   * @private
   */
  _calculateWeightedScore(scores) {
    let weightedSum = 0;
    
    for (const [factor, score] of Object.entries(scores)) {
      const weight = this.weights[factor] || 0;
      weightedSum += score * weight;
    }
    
    return weightedSum;
  }
}

export default OpportunityRankingEngine;