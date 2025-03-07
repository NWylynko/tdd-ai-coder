#!/usr/bin/env node
// src/index.ts
import 'source-map-support/register.js';
import 'dotenv/config';
import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import path from 'path';
import { startTddAiLoop } from './orchestrator.js';
import { startUiServer } from './ui/server.js';
import { UiServer, StatusUpdate, TddAiState } from './types.js';
import { logger } from './utils/logger.js';

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
  .option('--log-level <level>', 'Set log level (debug, info, warn, error)', 'info')
  .action(async (options) => {
    // Process options
    const projectPath = path.resolve(options.project);
    const maxAttempts = parseInt(options.maxAttempts, 10);
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

    // Check OpenAI API key
    if (!process.env.OPENAI_API_KEY) {
      console.error(chalk.red('Error: OPENAI_API_KEY not found in environment variables'));
      console.log('Please set your API key:');
      console.log('  export OPENAI_API_KEY=your_api_key_here');
      console.log('  or create a .env file with OPENAI_API_KEY=your_api_key_here');
      process.exit(1);
    }

    let spinner = ora('Starting TDD-AI Coder...').start();

    // Display configuration info
    console.log(chalk.blue('🧪 TDD-AI Coder'));
    console.log(chalk.gray(`Project path: ${projectPath}`));
    console.log(chalk.gray(`Test pattern: ${options.testPattern}`));
    console.log(chalk.gray(`Max attempts: ${maxAttempts}`));
    console.log(chalk.gray(`Log level: ${logLevel}`));

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

    let tddAi: { stop: () => Promise<void>; getState: () => TddAiState };
    try {
      tddAi = await startTddAiLoop({
        projectPath,
        testPattern: options.testPattern,
        maxAttempts,
        onUpdate: handleStatusUpdate,
      });
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

program.parse(process.argv);