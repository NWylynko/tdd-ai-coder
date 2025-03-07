// src/test-runner.ts
import { execa } from 'execa';
import { parseVitestOutput } from './utils/parse-output.js';
import { TestRunOptions, TestResult } from './types.js';
import { logger } from './utils/logger.js';
import fs from 'fs/promises';
import path from 'path';

/**
 * Runs Vitest and captures test results
 * @param options - Test runner options
 * @returns Promise with test results
 */
export async function runTests(options: TestRunOptions): Promise<TestResult> {
  const { projectPath, watch = false } = options;

  logger.info(`Running tests in ${projectPath} (watch mode: ${watch})`);
  logger.divider('debug');

  try {
    // Check if Vitest is installed
    await checkVitestInstallation(projectPath);

    // Start Vitest process
    logger.info('Starting Vitest process...');
    const vitestProcess = execa('npx', [
      'vitest', 'run',
      '--reporter', 'json',  // Use JSON reporter for easier parsing
      ...(watch ? ['--watch'] : [])
    ], {
      cwd: projectPath,
      reject: false, // Don't throw on test failure
      env: {
        ...process.env,
        FORCE_COLOR: 'true'  // Ensure colors are enabled
      }
    });

    let output = '';
    let errorOutput = '';

    // Capture standard output
    vitestProcess.stdout?.on('data', (data) => {
      const chunk = data.toString();
      output += chunk;
      logger.debug(`Vitest stdout: ${chunk.substring(0, 200)}${chunk.length > 200 ? '...' : ''}`);
    });

    // Capture error output
    vitestProcess.stderr?.on('data', (data) => {
      const chunk = data.toString();
      errorOutput += chunk;
      logger.warn(`Vitest stderr: ${chunk}`);
    });

    // Wait for the process to complete when not in watch mode
    if (!watch) {
      logger.debug('Waiting for Vitest process to complete...');
      const result = await vitestProcess;
      logger.info(`Vitest process completed with exit code: ${result.exitCode}`);

      // If we have an exit code but no output, something went wrong
      if (result.exitCode !== 0 && output.trim() === '') {
        logger.error('Vitest process failed with no output');
        if (errorOutput) {
          logger.error('Error output:', errorOutput);
        }
        return {
          success: false,
          error: errorOutput || `Vitest process failed with exit code ${result.exitCode}`
        };
      }
    }

    // If we didn't get any output but we have error output, use that
    if (output.trim() === '' && errorOutput) {
      logger.warn('No standard output from Vitest, using error output');
      output = `{"error": "${errorOutput.replace(/"/g, '\\"')}"}`;
    }

    logger.debug('Parsing Vitest output...');
    // Parse test results
    const testResults = parseVitestOutput(output);

    // Log file paths for debugging
    if (testResults.files && testResults.files.length > 0) {
      logger.debug('Test files in results:');
      testResults.files.forEach((file, index) => {
        logger.debug(`  [${index}] ${file.file} (${file.tests.length} tests, ${file.tests.filter(t => !t.success).length} failing, file marked as ${file.success ? 'success' : 'failing'})`);
      });
    }

    // Analyze raw output for debugging
    if (output && output.length > 0 && output.includes('"testResults"')) {
      try {
        const parsedOutput = JSON.parse(output);

        if (Array.isArray(parsedOutput.testResults)) {
          logger.debug('Raw testResults from Vitest:');
          parsedOutput.testResults.forEach((result: any, i: number) => {
            const filePath = result.name || result.filepath || result.file || `unknown-${i}`;
            const failedAssertions = result.assertionResults?.filter((a: any) => a.status === 'failed')?.length || 0;
            logger.debug(`  [${i}] ${filePath} (failed: ${failedAssertions}, status: ${result.status})`);
          });
        }
      } catch (e) {
        logger.debug('Could not parse raw output for additional debugging');
      }
    }

    logger.info(`Test results summary: ${testResults.summary.passed}/${testResults.summary.total} tests passed`);

    return {
      success: vitestProcess.exitCode === 0,
      results: testResults,
      process: watch ? vitestProcess : undefined, // Return process handle if in watch mode
    };
  } catch (error) {
    logger.error('Error running tests:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Checks if Vitest is installed in the project
 */
async function checkVitestInstallation(projectPath: string): Promise<void> {
  try {
    // Check if there's a package.json
    const packageJsonPath = path.join(projectPath, 'package.json');
    const packageJsonExists = await fileExists(packageJsonPath);

    if (!packageJsonExists) {
      logger.warn(`No package.json found in ${projectPath} - Vitest might not be installed`);
      return;
    }

    const packageJsonContent = await fs.readFile(packageJsonPath, 'utf-8');
    const packageJson = JSON.parse(packageJsonContent);

    // Check if vitest is in dependencies or devDependencies
    const hasVitest =
      (packageJson.dependencies && packageJson.dependencies.vitest) ||
      (packageJson.devDependencies && packageJson.devDependencies.vitest);

    if (!hasVitest) {
      logger.warn('Vitest is not listed in package.json dependencies');
      logger.info('Will attempt to use npx to run Vitest');
    } else {
      logger.debug('Vitest found in package.json');
    }

    // Check if node_modules exists
    const nodeModulesPath = path.join(projectPath, 'node_modules');
    const nodeModulesExists = await fileExists(nodeModulesPath);

    if (!nodeModulesExists) {
      logger.warn('node_modules directory not found. Dependencies may not be installed.');
      logger.info('Will attempt to use npx to run Vitest');
    }

    // Check if vitest config exists
    const possibleConfigFiles = [
      'vitest.config.js',
      'vitest.config.ts',
      'vite.config.js',
      'vite.config.ts'
    ];

    let configFileFound = false;
    for (const configFile of possibleConfigFiles) {
      const configPath = path.join(projectPath, configFile);
      if (await fileExists(configPath)) {
        logger.debug(`Found config file: ${configFile}`);
        configFileFound = true;
        break;
      }
    }

    if (!configFileFound) {
      logger.info('No Vitest/Vite config file found. Using default configuration.');
    }

  } catch (error) {
    logger.warn('Error checking Vitest installation:', error);
    logger.info('Will attempt to proceed with tests anyway');
  }
}

/**
 * Helper to check if a file exists
 */
async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Stops a running test process
 * @param testProcess - Test process to stop
 */
export async function stopTests(testProcess: TestResult): Promise<void> {
  if (testProcess && testProcess.process) {
    logger.info('Stopping test process...');
    testProcess.process.kill();
    logger.debug('Test process stopped');
  }
}