#!/usr/bin/env node
// src/index.ts

// These imports should come first to ensure proper setup
import 'source-map-support/register.js';
import 'dotenv/config';

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import path from 'path';
import readline from 'readline';
import { startTddAiLoop } from './orchestrator.js';
import { startUiServer } from './ui/server.js';
import { UiServer, StatusUpdate, TddAiState, TestValidationStatus } from './types.js';
import { logger } from './utils/logger.js';
import { loadConfig, createSampleConfig } from './utils/config.js';

const program = new Command();

program
  .name('tdd-ai-coder')
  .description('TDD-driven AI code generator')
  .version('0.1.0');

program
  .command('start')
  .description('Start the TDD-AI loop')
  .option('-p, --project <path>', 'Path to the project', '.')
  .option('-t, --test-pattern <pattern>', 'Test file pattern', '**/*.test.{js,ts}')
  .option('-m, --max-attempts <number>', 'Maximum number of AI attempts', '10')
  .option('--ui', 'Start the web UI')
  .option('--ui-port <port>', 'Port for the web UI', '3000')
  .option('-d, --debug', 'Enable debug logging', false)
  .option('-v, --verbose', 'Enable verbose logging (includes all AI prompts and responses)', false)
  .option('--skip-validation', 'Skip test validation step', false)
  .option('--log-level <level>', 'Set log level (debug, info, warn, error)', 'info')
  .option('--ai-model <model>', 'AI model to use', 'gpt-4-turbo')
  .option('--ai-provider <provider>', 'AI provider to use (openai, anthropic, local)', 'openai')
  .option('--ai-temperature <temp>', 'Temperature for AI generation (0-1)', '0.2')
  .action(async (options) => {
    // Process options
    const projectPath = path.resolve(options.project);
    const uiPort = parseInt(options.uiPort, 10);

    // Configure logging
    const logLevel = options.debug ? 'debug' : options.logLevel;

    logger.configure({
      level: logLevel as any,
      timestamps: true,
      colors: true
    });

    // If verbose mode is enabled, set log level to debug
    if (options.verbose) {
      logger.configure({ level: 'debug' });
      logger.info('Verbose logging enabled');
    }

    logger.info('TDD-AI-Coder starting up...');

    // Load configuration
    const config = await loadConfig(options);

    let spinner = ora('Starting TDD-AI Coder...').start();

    // Display configuration info
    console.log(chalk.blue('🧪 TDD-AI Coder'));
    console.log(chalk.gray(`Project path: ${projectPath}`));
    console.log(chalk.gray(`Test pattern: ${config.project.testFilePattern}`));
    console.log(chalk.gray(`Max attempts: ${config.project.maxAttempts}`));
    console.log(chalk.gray(`Log level: ${config.logging.level}`));
    console.log(chalk.gray(`AI provider: ${config.ai.provider}`));
    console.log(chalk.gray(`AI model: ${config.ai.model}`));

    // Start UI if requested
    let uiServer: UiServer | undefined;
    if (options.ui) {
      spinner.text = 'Starting UI server...';
      try {
        uiServer = await startUiServer({
          port: uiPort,
          projectPath,
        });
        spinner.succeed(`UI server started at http://localhost:${uiPort}`);
        spinner = ora('Initializing...').start();
      } catch (error) {
        spinner.fail(`Failed to start UI server: ${error instanceof Error ? error.message : String(error)}`);
        console.log(chalk.yellow('Continuing without UI server...'));
        spinner = ora('Initializing...').start();
      }
    }

    // Create spinner handler for status updates
    const handleStatusUpdate = (update: StatusUpdate): void => {
      switch (update.status) {
        case 'running_tests':
          spinner.text = `Running tests (attempt ${update.attempt}/${update.maxAttempts})...`;
          break;
        case 'generating_code':
          spinner.text = `Generating implementation for ${path.basename(update.file || '')} (attempt ${update.attempt})...`;
          break;
        case 'implementation_updated':
          spinner.succeed(`Updated ${path.basename(update.file || '')} (attempt ${update.attempt})`);
          spinner = ora('Waiting for next step...').start();
          break;
        case 'validation_waiting':
          spinner.text = `Validating test file ${path.basename(update.file || '')}...`;
          break;
        case 'validation_warning':
          // Validation warnings are handled by the validation prompt
          // No spinner updates needed as the prompt will take over
          spinner.stop();
          break;
        case 'success':
          spinner.succeed(chalk.green(update.message || 'Success!'));
          if (uiServer) {
            console.log(chalk.green(`You can view the results at http://localhost:${uiPort}`));
          }
          break;
        case 'error':
          spinner.fail(chalk.red(update.message || 'Error occurred'));
          spinner = ora('Waiting for next step...').start();
          break;
        case 'max_attempts_reached':
          spinner.fail(chalk.yellow(update.message || 'Max attempts reached'));
          if (uiServer) {
            console.log(chalk.gray(`You can view the results at http://localhost:${uiPort}`));
          }
          break;
      }
    };

    // Start the TDD-AI loop
    spinner.text = 'Initializing TDD-AI loop...';

    // Create validation prompt handler
    const validationPrompt = createValidationPrompt();

    let tddAi: { stop: () => Promise<void>; getState: () => TddAiState };
    try {
      tddAi = await startTddAiLoop({
        projectPath,
        onValidationIssue: validationPrompt,
        onUpdate: handleStatusUpdate,
      }, config);
    } catch (error) {
      spinner.fail(`Failed to start TDD-AI loop: ${error instanceof Error ? error.message : String(error)}`);
      if (uiServer) {
        await uiServer.stop();
      }
      process.exit(1);
    }

    // Handle process termination
    process.on('SIGINT', async () => {
      console.log(''); // Add a newline for better output
      spinner.text = 'Shutting down...';

      try {
        await tddAi.stop();

        if (uiServer) {
          await uiServer.stop();
        }

        spinner.succeed('TDD-AI Coder shut down');
      } catch (error) {
        spinner.fail(`Error during shutdown: ${error instanceof Error ? error.message : String(error)}`);
      }

      process.exit(0);
    });
  });

// Add a command to initialize config - MOVED BEFORE parse()
program
  .command('init')
  .description('Initialize a configuration file')
  .option('-d, --directory <path>', 'Directory to create the config file in', '.')
  .action(async (options) => {
    console.log(chalk.blue('🔧 Initializing TDD-AI Coder configuration'));
    const directory = path.resolve(options.directory);

    try {
      createSampleConfig(directory);
      console.log(chalk.green(`Configuration file created successfully in ${directory}`));
      console.log(chalk.gray('You can now edit this file to customize the behavior of TDD-AI Coder.'));
    } catch (error) {
      console.error(chalk.red(`Error creating configuration file: ${error instanceof Error ? error.message : String(error)}`));
    }
  });

// Add a diagnostics command to help debug issues
program
  .command('diagnose')
  .description('Run diagnostics to check environment')
  .action(async () => {
    console.log(chalk.blue('🔍 TDD-AI Coder Diagnostics'));
    console.log(chalk.gray('---------------------------'));

    // Check Node.js version
    console.log(`Node.js version: ${process.version}`);

    // Check OpenAI API key
    const hasApiKey = !!process.env.OPENAI_API_KEY;
    console.log(`OpenAI API key: ${hasApiKey ? chalk.green('Present') : chalk.red('Missing')}`);

    // Check Vitest installation
    try {
      const result = await import('vitest');
      console.log(`Vitest: ${chalk.green('Installed')}`);
    } catch (error) {
      console.log(`Vitest: ${chalk.yellow('Not found in local dependencies')}`);
    }

    // Check other dependencies
    console.log(chalk.gray('---------------------------'));
    console.log('Environment looks good! Run "tdd-ai-coder start" to begin.');
  });

// Parse arguments AFTER all commands are registered
program.parse(process.argv);

/**
 * Creates an interactive prompt for the user to override validation warnings
 */
function createValidationPrompt(): (status: TestValidationStatus, testFilePath: string) => Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return (status: TestValidationStatus, testFilePath: string): Promise<boolean> => {
    return new Promise((resolve) => {
      console.log('\n');
      console.log(chalk.yellow.bold('⚠️  Test Validation Warning ⚠️'));
      console.log(chalk.yellow(`The AI found potential issues with test file: ${testFilePath}`));
      console.log('\n');

      console.log(chalk.white.bold('Overall Assessment:'));
      console.log(chalk.white(status.overallAssessment));
      console.log('\n');

      console.log(chalk.white.bold('Issues Found:'));
      status.issues.forEach((issue, index) => {
        const color = issue.severity === 'error' ? chalk.red : chalk.yellow;
        console.log(color(`${index + 1}. [${issue.severity.toUpperCase()}] ${issue.message}`));
        if (issue.location) {
          console.log(color(`   Location: ${issue.location}`));
        }
        if (issue.suggestion) {
          console.log(color(`   Suggestion: ${issue.suggestion}`));
        }
      });

      console.log('\n');
      console.log(chalk.white('These issues might make it difficult for the AI to implement a solution.'));
      console.log(chalk.white('You can either:'));
      console.log(chalk.white('1. Stop and fix the issues in your test'));
      console.log(chalk.white('2. Continue anyway (the AI will try its best)'));
      console.log('\n');

      rl.question(chalk.cyan('Do you want to continue anyway? (y/N): '), (answer) => {
        const shouldContinue = answer.toLowerCase() === 'y';
        if (shouldContinue) {
          console.log(chalk.green('Continuing with implementation despite validation warnings...'));
        } else {
          console.log(chalk.blue('Stopping to allow test fixes. Run again after fixing the issues.'));
        }

        // Don't close the readline interface as it might be used again
        // rl.close();

        resolve(shouldContinue);
      });
    });
  };
}