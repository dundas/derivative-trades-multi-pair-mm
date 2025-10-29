#!/usr/bin/env node

/**
 * Strategy Analysis Runner
 * 
 * This script runs the StrategyPerformanceAnalyzer against all available
 * pricing and sizing strategies to identify optimal combinations for different
 * market conditions.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { StrategyPerformanceAnalyzer } from './StrategyPerformanceAnalyzer.js';
import { TradingLogger } from '../../../../utils/trading-logger.js';

// Import all pricing strategies
import TraditionalPricingStrategy from '../../strategies/pricing/traditional-pricing-strategy.js';
import RiskAdjustedPricingStrategy from '../../strategies/pricing/risk-adjusted-pricing-strategy.js';
import HybridPricingStrategy from '../../strategies/pricing/hybrid-pricing-strategy.js';
import AvellanedaPricingStrategy from '../../strategies/pricing/avellaneda-pricing-strategy.js';
import VolumeWeightedPricingStrategy from '../../strategies/pricing/volume-weighted-pricing-strategy.js';

// Import all sizing strategies
import FixedSizingStrategy from '../../strategies/sizing/fixed-sizing-strategy.js';
import MinSizingStrategy from '../../strategies/sizing/min-sizing-strategy.js';
import AverageSizingStrategy from '../../strategies/sizing/average-sizing-strategy.js';
import DistributionSizingStrategy from '../../strategies/sizing/distribution-sizing-strategy.js';

// Set up logger
const logger = new TradingLogger({
  component: 'StrategyAnalysisRunner',
  symbol: 'BTC/USD',
  sessionId: `analysis-${Date.now()}`
});

// Get current directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Create output directory if it doesn't exist
const outputDir = path.join(__dirname, '../../../../reports/strategy-analysis');
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

/**
 * Initialize all pricing strategies
 * @returns {Object} Map of pricing strategies
 */
function initializePricingStrategies() {
  return {
    'Traditional': new TraditionalPricingStrategy({ bidPercentage: 0.1, askPercentage: 0.1 }),
    'RiskAdjusted': new RiskAdjustedPricingStrategy({ riskFactor: 0.5 }),
    'Hybrid': new HybridPricingStrategy({ riskFactor: 0.5, bidPercentage: 0.1, askPercentage: 0.1 }),
    'Avellaneda': new AvellanedaPricingStrategy({ gamma: 0.1, kappa: 1.5 }),
    'VolumeWeighted': new VolumeWeightedPricingStrategy({ depth: 5, weightDecay: 0.8 })
  };
}

/**
 * Initialize all sizing strategies
 * @returns {Object} Map of sizing strategies
 */
function initializeSizingStrategies() {
  return {
    'Fixed': new FixedSizingStrategy({ bidSize: 0.01, askSize: 0.01 }),
    'Min': new MinSizingStrategy({ minSize: 0.001 }),
    'Average': new AverageSizingStrategy({ windowSize: 10 }),
    'Distribution': new DistributionSizingStrategy({ baseSize: 0.01, skewFactor: 0.5 })
  };
}

/**
 * Run the analysis and save the report
 */
async function runAnalysis() {
  logger.info('Starting strategy analysis');
  
  try {
    // Initialize strategies
    const pricingStrategies = initializePricingStrategies();
    const sizingStrategies = initializeSizingStrategies();
    
    logger.info('Initialized strategies', {
      pricingCount: Object.keys(pricingStrategies).length,
      sizingCount: Object.keys(sizingStrategies).length
    });
    
    // Create the analyzer
    const analyzer = new StrategyPerformanceAnalyzer({
      pricingStrategies,
      sizingStrategies,
      symbol: 'BTC/USD',
      logger
    });
    
    // Run the analysis
    logger.info('Running comprehensive analysis');
    const results = await analyzer.analyzeAll();
    
    // Generate the report
    logger.info('Generating analysis report');
    const report = analyzer.generateReport();
    
    // Save the report
    const timestamp = new Date().toISOString().replace(/:/g, '-').replace(/\..+/, '');
    const reportPath = path.join(outputDir, `strategy-analysis-${timestamp}.md`);
    fs.writeFileSync(reportPath, report);
    
    // Save the raw results as JSON
    const resultsPath = path.join(outputDir, `strategy-analysis-results-${timestamp}.json`);
    fs.writeFileSync(resultsPath, JSON.stringify(results, null, 2));
    
    logger.info('Analysis complete', {
      reportPath,
      resultsPath,
      strategyCount: Object.keys(results.byStrategy).length,
      conditionCount: Object.keys(results.byCondition).length
    });
    
    // Print summary to console
    console.log('\n=== Strategy Analysis Summary ===\n');
    
    if (results.summary.bestOverall) {
      console.log(`Best Overall Strategy: ${results.summary.bestOverall}`);
    }
    
    if (results.summary.bestLowRisk) {
      console.log(`Best Low-Risk Strategy: ${results.summary.bestLowRisk}`);
    }
    
    if (results.summary.bestHighVolatility) {
      console.log(`Best for High Volatility: ${results.summary.bestHighVolatility}`);
    }
    
    if (results.summary.bestLowLiquidity) {
      console.log(`Best for Low Liquidity: ${results.summary.bestLowLiquidity}`);
    }
    
    console.log('\nTop 3 Strategies:');
    results.summary.strategyRankings.slice(0, 3).forEach((strategy, index) => {
      console.log(`${index + 1}. ${strategy.key} (Score: ${strategy.averageScore.toFixed(4)})`);
    });
    
    console.log(`\nFull report saved to: ${reportPath}`);
    
    return { reportPath, resultsPath };
  } catch (error) {
    logger.error('Error running strategy analysis', {
      error: error.message,
      stack: error.stack
    });
    console.error('Error running strategy analysis:', error);
    throw error;
  }
}

// Run the analysis if this script is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runAnalysis()
    .then(({ reportPath }) => {
      console.log(`\nAnalysis complete. Report saved to: ${reportPath}`);
      process.exit(0);
    })
    .catch(error => {
      console.error('Analysis failed:', error);
      process.exit(1);
    });
}

export { runAnalysis };
