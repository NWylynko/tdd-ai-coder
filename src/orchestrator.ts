// src/orchestrator.ts
import fs from 'fs/promises';
import path from 'path';
import { runTests, stopTests } from './test-runner.js';
import { generateImplementation, applyGeneratedCode } from './ai-service.js';
import { startWatcher, stopWatcher } from './watcher.js';
import { logger } from './utils/logger.js';
import {
  OrchestratorOptions,
  TddAiState,
  StatusUpdate,
  ImplementationAttempt
} from './types.js';

/**
 * Main orchestration logic to run the TDD-AI loop
 * @param options - Orchestrator options
 * @returns Promise with control handlers
 */
export async function startTddAiLoop(options: OrchestratorOptions): Promise<{
  stop: () => Promise<void>;
  getState: () => TddAiState;
}> {
  const {
    projectPath,
    testPattern = '**/*.test.{js,ts}',
    maxAttempts = 10,
    onUpdate = console.log,
  } = options;

  logger.info(`Starting TDD-AI loop for project: ${projectPath}`);
  logger.info(`Test pattern: ${testPattern}`);
  logger.info(`Maximum attempts: ${maxAttempts}`);

  // State to track progress
  const state: TddAiState = {
    running: true,
    attempts: 0,
    allTestsPassing: false,
    history: [],
  };

  // Start file watcher
  logger.info('Starting file watcher...');
  const watcher = await startWatcher({
    projectPath,
    testPattern,
    onChange: async (changedFile: string) => {
      logger.info(`File changed: ${changedFile}`);

      // Reset state when tests change
      if (changedFile.endsWith('.test.js') || changedFile.endsWith('.test.ts')) {
        logger.info('Test file changed, resetting state and restarting loop');
        state.attempts = 0;
        state.allTestsPassing = false;
        state.history = [];

        // Run the main loop
        await runLoop();
      }
    },
  });

  // Main feedback loop
  async function runLoop(): Promise<void> {
    logger.info('Starting TDD-AI feedback loop');

    while (state.running && !state.allTestsPassing && state.attempts < maxAttempts) {
      state.attempts++;

      logger.info(`--- Starting attempt ${state.attempts}/${maxAttempts} ---`);
      logger.divider('debug');

      onUpdate({
        status: 'running_tests',
        attempt: state.attempts,
        maxAttempts,
      });

      // 1. Run tests
      logger.info('Running tests...');
      const testResults = await runTests({ projectPath });

      if (testResults.error) {
        logger.error(`Test run error: ${testResults.error}`);
      }

      // Create attempt record early to track all information
      const currentAttempt: ImplementationAttempt = {
        timestamp: new Date(),
        attempt: state.attempts,
        implementation: '', // Will be filled later
        testResults: {
          totalTests: testResults.results?.summary.total || 0,
          passingTests: testResults.results?.summary.passed || 0,
          failingTests: testResults.results?.summary.failed || 0,
        }
      };

      // All tests passing?
      if (testResults.success) {
        logger.info('🎉 All tests are passing!');
        state.allTestsPassing = true;

        // Update the current attempt with success status
        currentAttempt.success = true;
        state.history.push(currentAttempt);

        onUpdate({
          status: 'success',
          message: `All tests passing after ${state.attempts} attempts!`,
        });
        break;
      }

      // 2. For each failing test file, generate implementation
      if (!testResults.results) {
        logger.error('No test results available');
        onUpdate({
          status: 'error',
          message: 'No test results available',
        });

        // Small delay before next attempt
        await new Promise(resolve => setTimeout(resolve, 1000));
        continue;
      }

      // Get all files with failing tests regardless of their success flag
      const filesWithFailingTests = testResults.results.files.filter(file =>
        file.tests.some((test: { success: boolean }) => !test.success)
      );

      logger.info(`Found ${filesWithFailingTests.length} files with failing tests out of ${testResults.results.files.length} total`);

      // Collect failure details for the attempt record
      if (!currentAttempt.testResults) {
        currentAttempt.testResults = {
          totalTests: 0,
          passingTests: 0,
          failingTests: 0,
          failureDetails: []
        };
      } else if (!currentAttempt.testResults.failureDetails) {
        currentAttempt.testResults.failureDetails = [];
      }

      filesWithFailingTests.forEach(file => {
        file.tests.forEach(test => {
          if (!test.success) {
            currentAttempt.testResults!.failureDetails!.push({
              name: test.name,
              error: test.error || 'Unknown error'
            });
          }
        });
      });

      // Process the failing files (or all files with failing tests)
      for (const fileResult of filesWithFailingTests.length > 0 ? filesWithFailingTests : testResults.results.files) {
        logger.info(`Processing failing file: ${fileResult.file}`);
        logger.debug(`File has ${fileResult.tests.length} tests, ${fileResult.tests.filter(t => !t.success).length} failing`);

        // Get the test code - handle both absolute and relative paths
        const testFilePath = fileResult.file.startsWith('/')
          ? fileResult.file
          : path.join(projectPath, fileResult.file);

        logger.info(`Reading test file: ${testFilePath}`);

        let testCode: string;
        try {
          testCode = await fs.readFile(testFilePath, 'utf-8');
          logger.debug(`Test file content length: ${testCode.length} characters`);
        } catch (err) {
          logger.error(`Error reading test file: ${testFilePath}`, err);
          onUpdate({
            status: 'error',
            message: `Error reading test file: ${err instanceof Error ? err.message : String(err)}`,
          });
          continue;
        }

        // Determine implementation file path
        const implementationPath = testFilePath
          .replace('.test.', '.')
          .replace('.spec.', '.');

        logger.info(`Implementation file path: ${implementationPath}`);

        // Get current implementation if it exists
        let currentImplementation = '';
        try {
          currentImplementation = await fs.readFile(implementationPath, 'utf-8');
          logger.info(`Current implementation exists (${currentImplementation.length} characters)`);
          logger.debug(`Implementation preview: ${currentImplementation.substring(0, 300)}${currentImplementation.length > 300 ? '...' : ''}`);
        } catch (err) {
          logger.info('Implementation file does not exist yet, will create it');
        }

        onUpdate({
          status: 'generating_code',
          file: implementationPath,
          attempt: state.attempts,
        });

        // 3. Generate implementation
        logger.info('Generating implementation code...');

        // Get previous attempts for this file to give the AI more context
        const previousAttemptsForFile = state.history
          .filter(attempt => attempt.fileUpdated === implementationPath)
          .map(attempt => ({
            attempt: attempt.attempt,
            implementation: attempt.implementation,
            testResults: attempt.testResults
          }));

        if (previousAttemptsForFile.length > 0) {
          logger.info(`Found ${previousAttemptsForFile.length} previous attempts for this file`);
        }

        const generated = await generateImplementation({
          testResults: fileResult,
          testCode,
          implementationPath,
          currentImplementation,
          previousAttempts: previousAttemptsForFile
        });

        if (!generated.success) {
          logger.error('Error generating implementation:', generated.error);
          onUpdate({
            status: 'error',
            message: `Error generating implementation: ${generated.error}`,
          });
          continue;
        }

        if (!generated.code) {
          logger.warn('AI returned success but no code was generated');
          onUpdate({
            status: 'error',
            message: 'AI returned empty implementation',
          });
          continue;
        }

        logger.info(`Generated implementation (${generated.code.length} characters)`);
        logger.debug(`Implementation preview: ${generated.code.substring(0, 300)}${generated.code.length > 300 ? '...' : ''}`);

        // 4. Apply the generated code
        logger.info('Applying generated code to file...');
        const applied = await applyGeneratedCode({
          code: generated.code,
          implementationPath,
        });

        if (!applied) {
          logger.error(`Error applying generated code to ${implementationPath}`);
          onUpdate({
            status: 'error',
            message: `Error applying generated code to ${implementationPath}`,
          });
          continue;
        }

        logger.info('Implementation applied successfully');

        // Update the current attempt with the implementation details
        currentAttempt.implementation = generated.code;
        currentAttempt.fileUpdated = implementationPath;
        currentAttempt.success = false; // We'll know on next run if it was successful

        // Add to history
        state.history.push(currentAttempt);

        onUpdate({
          status: 'implementation_updated',
          file: implementationPath,
          attempt: state.attempts,
        });
      }

      // Slight delay before next attempt
      logger.debug('Waiting before next attempt...');
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    if (state.attempts >= maxAttempts && !state.allTestsPassing) {
      logger.warn(`Reached maximum number of attempts (${maxAttempts}) without passing all tests.`);
      onUpdate({
        status: 'max_attempts_reached',
        message: `Reached maximum number of attempts (${maxAttempts}) without passing all tests.`,
      });
    }
  }

  // Start the loop
  await runLoop();

  // Cleanup function
  return {
    stop: async (): Promise<void> => {
      logger.info('Stopping TDD-AI loop...');
      state.running = false;
      await stopWatcher(watcher);
      logger.info('TDD-AI loop stopped');
    },
    getState: (): TddAiState => ({ ...state }),
  };
}