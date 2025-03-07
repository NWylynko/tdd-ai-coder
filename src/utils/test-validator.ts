// src/utils/test-validator.ts
import { TestFileResult } from '../types.js';
import { logger } from './logger.js';
import { OpenAI } from 'openai';
import { TddAiConfig } from './config.js';

// OpenAI client instance (to be initialized)
let openai: OpenAI | null = null;

export interface TestValidationResult {
  isValid: boolean;
  issues: TestIssue[];
  overallAssessment: string;
}

export interface TestIssue {
  severity: 'warning' | 'error';
  message: string;
  location?: string;
  suggestion?: string;
}

/**
 * Share the OpenAI instance from AI service
 * @param aiClient The OpenAI client instance
 */
export function setOpenAIClient(aiClient: OpenAI): void {
  openai = aiClient;
  logger.debug('OpenAI client shared with test validator');
}

/**
 * Validates a test file for logical inconsistencies and common mistakes
 * @param testFilePath - Path to the test file
 * @param testCode - Content of the test file
 * @param testResults - Test results if available
 * @param config - Application configuration
 * @returns Validation results with any issues found
 */
export async function validateTests(
  testFilePath: string,
  testCode: string,
  testResults?: TestFileResult,
  config?: TddAiConfig
): Promise<TestValidationResult> {
  logger.info(`Validating test file: ${testFilePath}`);

  // First, do a quick static analysis for common issues
  const staticIssues = performStaticAnalysis(testCode);

  if (staticIssues.length > 0) {
    logger.warn(`Found ${staticIssues.length} potential issues with static analysis`);
  }

  // Then, use the LLM for deeper analysis if available
  try {
    if (!openai) {
      logger.warn('OpenAI client not initialized for test validation, using static analysis only');
      return {
        isValid: staticIssues.every(issue => issue.severity !== 'error'),
        issues: staticIssues,
        overallAssessment: 'Basic validation performed. LLM validation unavailable.'
      };
    }

    const llmAnalysis = await performLLMAnalysis(testCode, testResults, config);

    // Combine the results
    const allIssues = [...staticIssues, ...llmAnalysis.issues];

    // Determine if the test is valid based on issues
    const isValid = !allIssues.some(issue => issue.severity === 'error');

    logger.info(`Test validation complete. Valid: ${isValid}, Issues: ${allIssues.length}`);

    return {
      isValid,
      issues: allIssues,
      overallAssessment: llmAnalysis.overallAssessment
    };
  } catch (error) {
    logger.error('Error during test validation:', error);

    // If LLM analysis fails, just return static analysis results
    return {
      isValid: staticIssues.every(issue => issue.severity !== 'error'),
      issues: staticIssues,
      overallAssessment: 'Test validation could not be completed due to an error. Basic issues check performed.'
    };
  }
}

/**
 * Performs static analysis on test code to find common issues
 */
function performStaticAnalysis(testCode: string): TestIssue[] {
  const issues: TestIssue[] = [];

  // Check for empty test blocks
  if (testCode.includes('it(') && testCode.includes('() => {}) ')) {
    issues.push({
      severity: 'warning',
      message: 'Empty test block detected',
      suggestion: 'Add assertions to the empty test block'
    });
  }

  // Check for tests without assertions
  const testBlocks = testCode.match(/it\s*\([^{]*{[^}]*}/g) || [];
  for (const block of testBlocks) {
    if (!block.includes('expect(') && !block.includes('assert.')) {
      issues.push({
        severity: 'warning',
        message: 'Test without assertions detected',
        suggestion: 'Add assertions to verify expected behavior'
      });
    }
  }

  // Check for hardcoded timeouts
  if (testCode.match(/setTimeout\s*\(\s*[^,]*,\s*\d+\s*\)/)) {
    issues.push({
      severity: 'warning',
      message: 'Hardcoded timeout detected in tests',
      suggestion: 'Consider using mocks or more reliable testing approaches instead of timeouts'
    });
  }

  // Check for test doubles (mocks, stubs) that aren't restored/reset
  if ((testCode.includes('mock(') || testCode.includes('stub(')) &&
    !testCode.includes('restore') && !testCode.includes('reset')) {
    issues.push({
      severity: 'warning',
      message: 'Test doubles (mocks/stubs) appear to not be restored',
      suggestion: 'Ensure all mocks and stubs are restored in afterEach or after tests'
    });
  }

  return issues;
}

/**
 * Uses an LLM to analyze test code for logical issues
 */
async function performLLMAnalysis(
  testCode: string,
  testResults?: TestFileResult,
  config?: TddAiConfig
): Promise<{ issues: TestIssue[], overallAssessment: string }> {
  if (!openai) {
    logger.warn('OpenAI client not initialized, skipping LLM test analysis');
    return { issues: [], overallAssessment: 'LLM analysis unavailable. Make sure the OpenAI client is properly initialized.' };
  }

  logger.info('Performing LLM analysis of test code...');

  // Create a prompt for the LLM
  const prompt = buildAnalysisPrompt(testCode, testResults);

  try {
    const response = await openai.chat.completions.create({
      model: config?.ai.model || 'gpt-4-turbo',
      messages: [
        {
          role: "system",
          content: `You are an expert test engineer who analyzes test code for logical issues, edge cases, 
          and testing best practices. Your task is to evaluate test code and provide detailed feedback on 
          potential issues, logical inconsistencies, and suggestions for improvement. Be thorough but fair in 
          your assessment. Format your response as JSON.`
        },
        {
          role: "user",
          content: prompt
        }
      ],
      temperature: config?.ai.temperature || 0.3,
      response_format: { type: "json_object" }
    });

    const analysisText = response.choices[0].message.content;

    if (!analysisText) {
      logger.warn('LLM returned empty analysis');
      return { issues: [], overallAssessment: 'No issues detected.' };
    }

    try {
      const analysis = JSON.parse(analysisText);

      const issues: TestIssue[] = (analysis.issues || []).map((issue: any) => ({
        severity: issue.severity || 'warning',
        message: issue.message || 'Unspecified issue',
        location: issue.location,
        suggestion: issue.suggestion
      }));

      return {
        issues,
        overallAssessment: analysis.overallAssessment || 'No overall assessment provided.'
      };
    } catch (parseError) {
      logger.error('Error parsing LLM analysis response:', parseError);
      return {
        issues: [],
        overallAssessment: 'Error parsing analysis results. The AI returned malformed JSON.'
      };
    }
  } catch (error) {
    logger.error('Error getting LLM analysis:', error);
    return {
      issues: [],
      overallAssessment: 'LLM analysis failed due to an API error.'
    };
  }
}

/**
 * Builds a prompt for the LLM to analyze test code
 */
function buildAnalysisPrompt(testCode: string, testResults?: TestFileResult): string {
  let prompt = `
Please analyze the following test code for logical issues, inconsistencies, and best practices.
Focus on:
1. Test completeness (are all edge cases covered?)
2. Logical consistency (do the tests make sense?)
3. Test isolation (could tests interfere with each other?)
4. Test reliability (are there potential flaky tests?)
5. Assertions (are expectations clear and appropriate?)

Test code:
\`\`\`
${testCode}
\`\`\`
`;

  if (testResults) {
    prompt += `
Test execution results:
- Total tests: ${testResults.tests.length}
- Passing tests: ${testResults.tests.filter(t => t.success).length}
- Failing tests: ${testResults.tests.filter(t => !t.success).length}

Failing tests:
${testResults.tests.filter(t => !t.success).map(test => `- ${test.name}: ${test.error || 'Unknown error'}`).join('\n')}
`;
  }

  prompt += `
Respond with a JSON object that includes:
1. An array of "issues" with each issue having:
   - "severity": either "warning" or "error"
   - "message": clear description of the issue
   - "location": reference to where in the code the issue occurs (if applicable)
   - "suggestion": recommended fix or improvement
2. An "overallAssessment" string with your general evaluation of the test quality

Example response format:
{
  "issues": [
    {
      "severity": "warning",
      "message": "Test 'should calculate total' doesn't check edge cases",
      "location": "line 24-28",
      "suggestion": "Add tests for empty arrays and negative numbers"
    }
  ],
  "overallAssessment": "Tests are generally well-structured but missing some edge cases."
}
`;

  return prompt;
}

/**
 * Checks if the user has overridden test validation for a specific file
 * @param testFilePath Path to the test file
 * @returns True if the user has overridden validation
 */
export function isValidationOverridden(testFilePath: string): boolean {
  // This would ideally check a config file or database
  // For now, we'll use an environment variable pattern
  const overridePattern = process.env.TEST_VALIDATION_OVERRIDE;
  if (!overridePattern) return false;

  // Check if the file path matches the override pattern
  return new RegExp(overridePattern).test(testFilePath);
}

/**
 * Sets a validation override for a specific test file
 * @param testFilePath Path to the test file to override
 */
export function setValidationOverride(testFilePath: string): void {
  // In a real implementation, this would update a config file or database
  // For now, just log the action
  logger.info(`Test validation override set for: ${testFilePath}`);

  // Example implementation using environment variables
  const currentOverrides = process.env.TEST_VALIDATION_OVERRIDE || '';
  if (currentOverrides) {
    process.env.TEST_VALIDATION_OVERRIDE = `${currentOverrides}|${testFilePath.replace(/\\/g, '\\\\')}`;
  } else {
    process.env.TEST_VALIDATION_OVERRIDE = testFilePath.replace(/\\/g, '\\\\');
  }
}