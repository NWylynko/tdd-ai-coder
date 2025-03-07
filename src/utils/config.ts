// src/utils/config.ts
import fs from 'fs';
import path from 'path';
import { cosmiconfig } from 'cosmiconfig';
import { logger } from './logger.js';

/**
 * Configuration interface for TDD-AI-Coder
 */
export interface TddAiConfig {
  // AI Settings
  ai: {
    provider: 'openai' | 'anthropic' | 'local';
    model: string;
    temperature: number;
    maxTokens?: number;
    apiKey?: string;
    apiEndpoint?: string;
    timeout: number;
  };

  // Test Runner Settings
  testRunner: {
    command: string;
    args: string[];
    jsonReporter: boolean;
    timeout: number;
  };

  // Validation Settings
  validation: {
    enabled: boolean;
    validateOnFirstRunOnly: boolean;
    severityThreshold: 'warning' | 'error';
  };

  // Project Settings
  project: {
    testFilePattern: string;
    maxAttempts: number;
    implExtension: string;
    waitBetweenAttempts: number;
  };

  // Logging Settings
  logging: {
    level: 'debug' | 'info' | 'warn' | 'error';
    timestamps: boolean;
    colors: boolean;
    saveHistory: boolean;
    historyPath: string;
  };
}

/**
 * Default configuration
 */
const defaultConfig: TddAiConfig = {
  ai: {
    provider: 'openai',
    model: 'gpt-4-turbo',
    temperature: 0.2,
    apiKey: process.env.OPENAI_API_KEY,
    timeout: 60000, // 1 minute
  },
  testRunner: {
    command: 'npx',
    args: ['vitest', 'run', '--reporter', 'json'],
    jsonReporter: true,
    timeout: 30000, // 30 seconds
  },
  validation: {
    enabled: true,
    validateOnFirstRunOnly: true,
    severityThreshold: 'error',
  },
  project: {
    testFilePattern: '**/*.test.{js,ts}',
    maxAttempts: 10,
    implExtension: '.ts',
    waitBetweenAttempts: 2000, // 2 seconds
  },
  logging: {
    level: 'info',
    timestamps: true,
    colors: true,
    saveHistory: true,
    historyPath: '.tdd-ai-history',
  }
};

/**
 * Loads configuration from multiple sources with the following precedence:
 * 1. Command line arguments
 * 2. Environment variables
 * 3. Config file (.tddairc, tddai.config.js, package.json)
 * 4. Default values
 * 
 * @param cliOptions Command line options that override config
 * @returns Merged configuration
 */
export async function loadConfig(cliOptions: Record<string, any> = {}): Promise<TddAiConfig> {
  // Start with default config
  let config = { ...defaultConfig };

  try {
    // Try to load config file using cosmiconfig
    const explorer = cosmiconfig('tddai');
    const result = await explorer.search();

    if (result && !result.isEmpty) {
      logger.debug(`Loaded config from ${result.filepath}`);

      // Merge the file config with defaults
      config = mergeConfigs(config, result.config);
    } else {
      logger.debug('No config file found, using defaults');
    }
  } catch (error) {
    logger.warn('Error loading config file:', error);
    logger.info('Proceeding with default configuration');
  }

  // Apply environment variables
  config = applyEnvironmentVariables(config);

  // Apply CLI options (highest precedence)
  config = applyCLIOptions(config, cliOptions);

  // Validate the final config
  validateConfig(config);

  logger.debug('Final configuration:', config);
  return config;
}

/**
 * Apply environment variables to override config
 */
function applyEnvironmentVariables(config: TddAiConfig): TddAiConfig {
  const newConfig = { ...config };

  // AI settings
  if (process.env.TDDAI_AI_PROVIDER) {
    newConfig.ai.provider = process.env.TDDAI_AI_PROVIDER as any;
  }
  if (process.env.TDDAI_AI_MODEL) {
    newConfig.ai.model = process.env.TDDAI_AI_MODEL;
  }
  if (process.env.TDDAI_AI_TEMPERATURE) {
    newConfig.ai.temperature = parseFloat(process.env.TDDAI_AI_TEMPERATURE);
  }
  if (process.env.OPENAI_API_KEY) {
    newConfig.ai.apiKey = process.env.OPENAI_API_KEY;
  }
  if (process.env.ANTHROPIC_API_KEY) {
    newConfig.ai.apiKey = process.env.ANTHROPIC_API_KEY;
  }
  if (process.env.TDDAI_AI_API_ENDPOINT) {
    newConfig.ai.apiEndpoint = process.env.TDDAI_AI_API_ENDPOINT;
  }

  // Validation settings
  if (process.env.TDDAI_VALIDATION_ENABLED) {
    newConfig.validation.enabled = process.env.TDDAI_VALIDATION_ENABLED === 'true';
  }

  // Project settings
  if (process.env.TDDAI_MAX_ATTEMPTS) {
    newConfig.project.maxAttempts = parseInt(process.env.TDDAI_MAX_ATTEMPTS, 10);
  }

  // Logging settings
  if (process.env.TDDAI_LOG_LEVEL) {
    newConfig.logging.level = process.env.TDDAI_LOG_LEVEL as any;
  }

  return newConfig;
}

/**
 * Apply CLI options to override config
 */
function applyCLIOptions(config: TddAiConfig, cliOptions: Record<string, any>): TddAiConfig {
  const newConfig = { ...config };

  // Map CLI options to config properties
  if (cliOptions.debug) {
    newConfig.logging.level = 'debug';
  }
  if (cliOptions.verbose) {
    newConfig.logging.level = 'debug';
  }
  if (cliOptions.logLevel) {
    newConfig.logging.level = cliOptions.logLevel as any;
  }
  if (cliOptions.skipValidation !== undefined) {
    newConfig.validation.enabled = !cliOptions.skipValidation;
  }
  if (cliOptions.maxAttempts !== undefined) {
    newConfig.project.maxAttempts = parseInt(cliOptions.maxAttempts, 10);
  }
  if (cliOptions.testPattern !== undefined) {
    newConfig.project.testFilePattern = cliOptions.testPattern;
  }
  if (cliOptions.aiModel !== undefined) {
    newConfig.ai.model = cliOptions.aiModel;
  }
  if (cliOptions.aiTemperature !== undefined) {
    newConfig.ai.temperature = parseFloat(cliOptions.aiTemperature);
  }

  return newConfig;
}

/**
 * Deep merge configs
 */
function mergeConfigs(baseConfig: TddAiConfig, overrideConfig: Partial<TddAiConfig>): TddAiConfig {
  const result = { ...baseConfig };

  // Recursively merge nested objects
  for (const key of Object.keys(overrideConfig)) {
    const typedKey = key as keyof TddAiConfig;

    if (typeof overrideConfig[typedKey] === 'object' &&
      overrideConfig[typedKey] !== null &&
      !Array.isArray(overrideConfig[typedKey])) {

      result[typedKey] = {
        ...result[typedKey],
        ...(overrideConfig[typedKey] as any)
      };
    } else {
      result[typedKey] = overrideConfig[typedKey] as any;
    }
  }

  return result;
}

/**
 * Validate the config for required fields and valid values
 */
function validateConfig(config: TddAiConfig): void {
  // Check for required AI provider settings
  if (config.ai.provider === 'openai' && !config.ai.apiKey) {
    logger.warn('No OpenAI API key provided. Set OPENAI_API_KEY environment variable.');
  }

  if (config.ai.provider === 'anthropic' && !config.ai.apiKey) {
    logger.warn('No Anthropic API key provided. Set ANTHROPIC_API_KEY environment variable.');
  }

  // Validate temperature range
  if (config.ai.temperature < 0 || config.ai.temperature > 1) {
    logger.warn(`Invalid AI temperature value: ${config.ai.temperature}. Using default: 0.2`);
    config.ai.temperature = 0.2;
  }

  // Validate max attempts
  if (config.project.maxAttempts < 1) {
    logger.warn(`Invalid max attempts value: ${config.project.maxAttempts}. Using default: 10`);
    config.project.maxAttempts = 10;
  }
}

/**
 * Create a sample config file in the specified directory
 */
export function createSampleConfig(directory: string): void {
  const configPath = path.join(directory, '.tddairc.json');

  // Check if file already exists
  if (fs.existsSync(configPath)) {
    logger.warn(`Config file already exists at ${configPath}`);
    return;
  }

  // Create a sample config based on defaults
  const sampleConfig = {
    ai: { ...defaultConfig.ai },
    validation: { ...defaultConfig.validation },
    project: { ...defaultConfig.project },
    logging: { ...defaultConfig.logging }
  };

  // Remove sensitive fields
  delete sampleConfig.ai.apiKey;

  try {
    fs.writeFileSync(
      configPath,
      JSON.stringify(sampleConfig, null, 2),
      'utf8'
    );
    logger.info(`Created sample config file at ${configPath}`);
  } catch (error) {
    logger.error(`Failed to create sample config file: ${error}`);
  }
}

// Export default config for reference
export { defaultConfig };