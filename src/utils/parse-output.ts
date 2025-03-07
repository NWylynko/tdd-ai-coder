// src/utils/parse-output.ts
import { TestResults } from '../types.js';
import { logger } from './logger.js';

/**
 * Parses Vitest JSON output into a structured format
 * @param output - Vitest JSON output string
 * @returns Structured test results
 */
export function parseVitestOutput(output: string): TestResults {
  try {
    logger.debug(`Raw output length: ${output.length} characters`);
    logger.debug(`Raw output preview: ${output.substring(0, 500)}${output.length > 500 ? '...' : ''}`);

    // Check if output is empty or invalid
    if (!output || output.trim() === '') {
      logger.error('Vitest output is empty');
      return createEmptyTestResults('Empty output from Vitest');
    }

    // Find the JSON part of the output (Vitest might output other logs)
    const jsonStart = output.indexOf('{');
    if (jsonStart === -1) {
      logger.error('Could not find JSON data in Vitest output');
      return createEmptyTestResults('No JSON data found in output');
    }

    // Try to find the end of the JSON object
    let jsonEnd = output.lastIndexOf('}');
    if (jsonEnd === -1) {
      logger.error('Could not find end of JSON data in Vitest output');
      return createEmptyTestResults('Incomplete JSON data in output');
    }

    const jsonPart = output.substring(jsonStart, jsonEnd + 1);
    logger.debug(`Extracted JSON length: ${jsonPart.length} characters`);
    logger.debug(`JSON preview: ${jsonPart.substring(0, 300)}...`);

    let data;
    try {
      data = JSON.parse(jsonPart);
      logger.debug('JSON parsed successfully');
    } catch (parseError) {
      logger.error('Failed to parse JSON:', parseError);
      // Try to extract a cleaner JSON string
      logger.debug('Attempting to find a cleaner JSON segment...');

      // Find nested JSON objects that might be complete
      const matches = [...jsonPart.matchAll(/\{(?:[^{}]|(?:\{[^{}]*\}))*\}/g)];
      if (matches.length > 0) {
        logger.debug(`Found ${matches.length} potential JSON objects`);
        for (const match of matches) {
          try {
            const cleanerJson = match[0];
            logger.debug(`Trying JSON segment: ${cleanerJson.substring(0, 100)}...`);
            data = JSON.parse(cleanerJson);
            logger.info('Successfully parsed alternative JSON segment');
            break;
          } catch (e) {
            logger.debug('Alternative JSON parsing failed');
          }
        }
      }

      if (!data) {
        return createEmptyTestResults(`JSON parse error: ${parseError instanceof Error ? parseError.message : String(parseError)}`);
      }
    }

    logger.debug('Examining parsed data structure');

    // Check for various Vitest output formats
    const fileResults = extractFileResults(data);

    if (!fileResults || fileResults.length === 0) {
      logger.warn('No file results found in the parsed data');
      logger.object('debug', 'Data structure', data);
      return createEmptyTestResults('No test files found in Vitest output');
    }

    const summary = extractSummary(data);

    logger.info(`Parsed ${fileResults.length} test files with ${summary.total} tests (${summary.passed} passed, ${summary.failed} failed)`);

    return {
      files: fileResults,
      summary
    };
  } catch (error) {
    logger.error('Unexpected error parsing Vitest output:', error);
    logger.debug('Problematic output:', output);

    // Return a basic structure with an error indication
    return createEmptyTestResults(error instanceof Error ? error.message : String(error));
  }
}

/**
 * Extracts file results from various Vitest output formats
 */
function extractFileResults(data: any): TestResults['files'] {
  logger.debug('Extracting file results');

  // Handle the array-based format (as seen in current Vitest output)
  if (Array.isArray(data.testResults)) {
    logger.debug('Found array-based testResults format');
    return data.testResults.map((fileResult: any, index: number) => {
      // Get the file path from the appropriate property
      const filePath = fileResult.name || fileResult.filepath || fileResult.file || `unknown-file-${index}`;

      // Extract the tests from assertionResults
      const tests = Array.isArray(fileResult.assertionResults)
        ? fileResult.assertionResults
        : [];

      // Transform the tests
      const transformedTests = tests.map((test: any) => ({
        name: test.fullName || test.title || 'Unnamed test',
        success: test.status === 'passed',
        error: test.status === 'failed' ? test.failureMessages?.[0] || 'Unknown error' : undefined,
        code: test.status === 'failed' ? extractTestCode(test) : undefined,
        duration: test.duration || 0,
        location: test.location ? `${test.location.line}:${test.location.column}` : undefined
      }));

      // Calculate if the file has failing tests
      const hasFailingTests = transformedTests.some((test: { success: boolean }) => !test.success);

      logger.debug(`File ${filePath} has ${tests.length} tests, ${transformedTests.filter((t: { success: boolean }) => !t.success).length} failing`);

      return {
        file: filePath,
        // Consider file failing if any test is failing
        success: !hasFailingTests,
        tests: transformedTests
      };
    });
  }

  // Try the object-based format (older Vitest versions)
  if (data.testResults && typeof data.testResults === 'object' && !Array.isArray(data.testResults)) {
    logger.debug('Found object-based testResults format');
    return Object.keys(data.testResults).map(filePath => {
      const fileResult = data.testResults[filePath];

      if (!fileResult) {
        logger.warn(`Missing result data for file: ${filePath}`);
        return {
          file: filePath,
          success: false,
          tests: []
        };
      }

      const tests = Array.isArray(fileResult.tests)
        ? fileResult.tests
        : [];

      logger.debug(`File ${filePath} has ${tests.length} tests`);

      return {
        file: filePath,
        success: fileResult.failures === 0,
        tests: tests.map((test: any) => ({
          name: test.name || 'Unnamed test',
          success: test.status === 'passed',
          error: test.status === 'failed' ? test.error?.message || 'Unknown error' : undefined,
          code: test.status === 'failed' ? extractTestCode(test) : undefined,
          duration: test.duration || 0
        }))
      };
    });
  }

  // Try alternative format - files array
  if (data.files && Array.isArray(data.files)) {
    logger.debug('Found alternative files array format');
    return data.files.map((file: any) => {
      const tests = Array.isArray(file.tests) ? file.tests : [];
      logger.debug(`File ${file.name || 'unknown'} has ${tests.length} tests`);

      return {
        file: file.name || 'unknown',
        success: !file.failed || file.failed === 0,
        tests: tests.map((test: any) => ({
          name: test.name || 'Unnamed test',
          success: test.status === 'pass' || test.status === 'passed',
          error: (test.status === 'fail' || test.status === 'failed') ? test.error?.message || 'Unknown error' : undefined,
          code: (test.status === 'fail' || test.status === 'failed') ? test.source || undefined : undefined,
          duration: test.duration || 0
        }))
      };
    });
  }

  // Handle custom format for CI environments 
  if (data.suites && Array.isArray(data.suites)) {
    logger.debug('Found suites array format');
    return data.suites.map((suite: any) => {
      const tests = Array.isArray(suite.tests) ? suite.tests : [];
      logger.debug(`Suite ${suite.name || 'unknown'} has ${tests.length} tests`);

      return {
        file: suite.file || suite.name || 'unknown',
        success: suite.status === 'passed',
        tests: tests.map((test: any) => ({
          name: test.name || 'Unnamed test',
          success: test.status === 'passed',
          error: test.status !== 'passed' ? test.error || 'Test failed' : undefined,
          code: test.status !== 'passed' ? test.code || undefined : undefined,
          duration: test.duration || 0
        }))
      };
    });
  }

  // Try reconstructing from raw results
  if (data.results && Array.isArray(data.results)) {
    logger.debug('Attempting to reconstruct from raw results array');

    // Group by file
    const fileMap: Record<string, any[]> = {};
    for (const result of data.results) {
      const file = result.file || 'unknown';
      if (!fileMap[file]) {
        fileMap[file] = [];
      }
      fileMap[file].push(result);
    }

    return Object.entries(fileMap).map(([file, tests]) => {
      logger.debug(`Reconstructed file ${file} with ${tests.length} tests`);

      return {
        file,
        success: tests.every(test => test.status === 'passed'),
        tests: tests.map(test => ({
          name: test.name || 'Unnamed test',
          success: test.status === 'passed',
          error: test.status !== 'passed' ? test.error || 'Test failed' : undefined,
          code: test.status !== 'passed' ? undefined : undefined,
          duration: test.duration || 0
        }))
      };
    });
  }

  // If we couldn't find any format, create a fake file result
  logger.warn('Could not determine test file format, creating placeholder');
  logger.object('debug', 'Unrecognized data structure', data);

  return [{
    file: 'unknown',
    success: false,
    tests: [{
      name: 'Placeholder test',
      success: false,
      error: 'Could not determine test format from Vitest output',
      duration: 0
    }]
  }];
}

/**
 * Extracts summary information from Vitest output
 */
function extractSummary(data: any): TestResults['summary'] {
  let total = 0;
  let passed = 0;
  let failed = 0;
  let duration = 0;

  // Try different formats
  if (data.numTotalTests !== undefined) {
    total = data.numTotalTests || 0;
    passed = data.numPassedTests || 0;
    failed = data.numFailedTests || 0;
    duration = data.duration || 0;
  } else if (data.totals) {
    total = data.totals.tests || 0;
    passed = data.totals.passed || 0;
    failed = data.totals.failed || 0;
    duration = data.duration || 0;
  } else if (data.stats) {
    total = data.stats.tests || 0;
    passed = data.stats.passes || 0;
    failed = data.stats.failures || 0;
    duration = data.stats.duration || 0;
  }

  logger.debug(`Extracted summary: ${total} total, ${passed} passed, ${failed} failed, ${duration}ms`);

  return { total, passed, failed, duration };
}

/**
 * Extracts test code from a test result
 * This is a helper function that tries to get the relevant code from the test
 * @param test - Vitest test result
 * @returns The extracted test code or undefined
 */
function extractTestCode(test: any): string | undefined {
  // Try multiple ways to get the code

  // 1. From source property
  if (test.source) {
    return test.source;
  }

  // 2. From failure messages
  if (Array.isArray(test.failureMessages) && test.failureMessages.length > 0) {
    const message = test.failureMessages[0];
    // Extract the code from error message - usually shows the line that failed
    const codeLine = message?.split('\n')
      .find((line: string) => line.includes('expect(') || line.includes('assert.'));

    if (codeLine) {
      return codeLine.trim();
    }
  }

  // 3. From stack trace
  if (test.error?.stackTrace) {
    // Try to extract code from stack trace
    const stackLines = test.error.stackTrace.split('\n');
    for (const line of stackLines) {
      if (line.includes(test.file || '') && !line.includes('node_modules')) {
        return line.trim();
      }
    }
  }

  // 4. From assertion
  if (test.assertion) {
    return test.assertion;
  }

  return undefined;
}

/**
 * Helper function to create empty test results with error info
 */
function createEmptyTestResults(errorMessage: string): TestResults {
  logger.debug(`Creating empty test results with error: ${errorMessage}`);

  return {
    files: [{
      file: 'error',
      success: false,
      tests: [{
        name: 'Error',
        success: false,
        error: errorMessage,
        duration: 0
      }]
    }],
    summary: {
      total: 0,
      passed: 0,
      failed: 1,
      duration: 0,
      error: errorMessage
    }
  };
}