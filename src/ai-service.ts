// src/ai-service.ts
import { OpenAI } from 'openai';
import fs from 'fs/promises';
import path from 'path';
import { GenerateOptions, GenerateResult, ApplyCodeOptions } from './types.js';
import { logger } from './utils/logger.js';

// Initialize OpenAI client
let openai: OpenAI;

try {
  openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });
  logger.debug('OpenAI client initialized');
} catch (error) {
  logger.error('Failed to initialize OpenAI client:', error);
  throw new Error(`OpenAI initialization error: ${error instanceof Error ? error.message : String(error)}`);
}

/**
 * Generate code to make failing tests pass
 * @param options - Generation options
 * @returns Promise with generated code and explanation
 */
export async function generateImplementation(options: GenerateOptions): Promise<GenerateResult> {
  const {
    testResults,
    testCode,
    implementationPath,
    currentImplementation = '',
    previousAttempts = []
  } = options;

  logger.info(`Generating implementation for ${implementationPath}`);

  // Validate input
  if (!testResults || !testResults.tests) {
    logger.error('Invalid test results provided to generateImplementation');
    return {
      success: false,
      error: 'Invalid test results: no tests available',
    };
  }

  if (!testCode) {
    logger.error('No test code provided to generateImplementation');
    return {
      success: false,
      error: 'No test code provided',
    };
  }

  logger.debug(`Test file has ${testResults.tests.length} tests`);

  // Extract failing tests
  const failingTests = testResults.tests.filter(test => !test.success);

  if (failingTests.length === 0) {
    logger.info('No failing tests found');
    return {
      success: true,
      message: 'All tests are passing!',
      code: currentImplementation,
    };
  }

  logger.info(`Found ${failingTests.length} failing tests`);

  if (previousAttempts && previousAttempts.length > 0) {
    logger.info(`Including ${previousAttempts.length} previous attempts in the context`);
  }

  // Format the test failures for better AI context
  const formattedFailures = failingTests.map(test => ({
    name: test.name,
    error: test.error,
    code: test.code,
  }));

  logger.debug('Formatted failing tests:', JSON.stringify(formattedFailures, null, 2));

  // Create prompt for the AI
  const prompt = buildPrompt({
    testCode,
    failingTests: formattedFailures,
    currentImplementation,
    implementationPath,
    previousAttempts
  });

  logger.debug(`Generated prompt (${prompt.length} characters)`);

  try {
    // Call AI API
    logger.info('Calling OpenAI API to generate implementation...');

    // Verify API key presence
    if (!process.env.OPENAI_API_KEY) {
      logger.error('No OpenAI API key found in environment variables');
      return {
        success: false,
        error: 'OPENAI_API_KEY environment variable is not set'
      };
    }

    // Set timeout for API call
    const timeout = setTimeout(() => {
      logger.warn('OpenAI API call is taking longer than expected...');
    }, 10000);

    try {
      const response = await openai.chat.completions.create({
        model: "gpt-3.5-turbo", // Use appropriate model
        messages: [
          {
            role: "system",
            content: "You are an expert programmer tasked with implementing code to make failing tests pass. Respond only with valid code that could be inserted directly into the implementation file. Do not include markdown code blocks, explanations, or anything else that isn't code for the implementation."
          },
          {
            role: "user",
            content: prompt
          }
        ],
        temperature: 0.2, // Lower temperature for more deterministic output
      });

      clearTimeout(timeout);

      logger.info('Received response from OpenAI');

      if (!response.choices || response.choices.length === 0) {
        logger.error('OpenAI returned empty response');
        return {
          success: false,
          error: 'AI returned empty response'
        };
      }

      const generatedCode = response.choices[0].message.content?.trim() || '';

      // Clean up the code - remove any Markdown code fence markers
      const cleanedCode = removeMarkdownFormatting(generatedCode);

      if (!cleanedCode) {
        logger.error('OpenAI returned empty code after cleaning');
        return {
          success: false,
          error: 'AI returned empty code'
        };
      }

      logger.debug(`Generated code length: ${cleanedCode.length} characters`);
      logger.debug(`Generated code preview: ${cleanedCode.substring(0, 300)}${cleanedCode.length > 300 ? '...' : ''}`);

      return {
        success: true,
        code: cleanedCode,
        reasoning: response.choices[0].message.content || '',
      };
    } finally {
      clearTimeout(timeout);
    }
  } catch (error) {
    logger.error('Error generating implementation with OpenAI:', error);

    // Handle common API errors
    if (error instanceof Error) {
      if (error.message.includes('API key')) {
        return {
          success: false,
          error: 'Invalid or missing OpenAI API key'
        };
      }

      if (error.message.includes('rate limit')) {
        return {
          success: false,
          error: 'OpenAI API rate limit exceeded. Please try again later.'
        };
      }
    }

    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Builds a prompt for the AI model
 */
function buildPrompt({
  testCode,
  failingTests,
  currentImplementation,
  implementationPath,
  previousAttempts = []
}: {
  testCode: string;
  failingTests: Array<{
    name: string | undefined;
    error: string | undefined;
    code: string | undefined;
  }>;
  currentImplementation: string;
  implementationPath: string;
  previousAttempts?: Array<{
    attempt: number;
    implementation: string;
    testResults?: {
      passingTests: number;
      failingTests: number;
      failureDetails?: Array<{
        name: string;
        error: string;
      }>;
    };
  }>;
}): string {
  const fileExtension = path.extname(implementationPath);
  const isTypescript = fileExtension === '.ts' || fileExtension === '.tsx';

  let promptText = `
I need to implement code that passes these failing tests:

## Test File:
\`\`\`${isTypescript ? 'typescript' : 'javascript'}
${testCode}
\`\`\`

## Failing Tests:
${failingTests.map(test => `
- Test: ${test.name || 'Unnamed test'}
- Error: ${test.error || 'Unknown error'}
${test.code ? `- Code: ${test.code}` : ''}
`).join('\n')}

${currentImplementation ? `
## Current Implementation:
\`\`\`${isTypescript ? 'typescript' : 'javascript'}
${currentImplementation}
\`\`\`
` : ''}`;

  // Add previous attempts if available
  if (previousAttempts && previousAttempts.length > 0) {
    promptText += `\n\n## Previous Attempts:`;

    // Add a summary analysis section
    promptText += `\n\n### Analysis of Previous Attempts:`;
    promptText += `\nYou've made ${previousAttempts.length} previous attempts to solve this problem.`;

    // Find the attempt with the most passing tests
    const bestAttempt = [...previousAttempts].sort((a, b) =>
      (b.testResults?.passingTests || 0) - (a.testResults?.passingTests || 0)
    )[0];

    if (bestAttempt) {
      promptText += `\nYour best attempt was #${bestAttempt.attempt} with ${bestAttempt.testResults?.passingTests || 0} passing tests.`;
    }

    // Add pattern of errors if consistent across attempts
    const commonErrors = new Map<string, number>();
    previousAttempts.forEach((attempt: {
      attempt: number;
      implementation: string;
      testResults?: {
        passingTests: number;
        failingTests: number;
        failureDetails?: Array<{ name: string; error: string; }>
      }
    }) => {
      attempt.testResults?.failureDetails?.forEach((failure: { name: string; error: string }) => {
        const key = `${failure.name}: ${failure.error}`;
        commonErrors.set(key, (commonErrors.get(key) || 0) + 1);
      });
    });

    const persistentErrors = Array.from(commonErrors.entries())
      .filter(([_, count]) => count >= Math.ceil(previousAttempts.length / 2))
      .map(([error, _]) => error);

    if (persistentErrors.length > 0) {
      promptText += `\n\nPersistent errors that have appeared in multiple attempts:`;
      persistentErrors.forEach(error => {
        promptText += `\n- ${error}`;
      });
    }

    // Now add the detailed attempt history
    for (const attempt of previousAttempts) {
      promptText += `\n\n### Attempt ${attempt.attempt}:`;
      promptText += `\n\`\`\`${isTypescript ? 'typescript' : 'javascript'}\n${attempt.implementation}\n\`\`\``;

      if (attempt.testResults) {
        promptText += `\n\nResults: ${attempt.testResults.passingTests} passing, ${attempt.testResults.failingTests} failing`;

        if (attempt.testResults.failureDetails && attempt.testResults.failureDetails.length > 0) {
          promptText += `\n\nFailures:`;
          for (const failure of attempt.testResults.failureDetails) {
            promptText += `\n- ${failure.name}: ${failure.error}`;
          }
        }
      }
    }
  }

  promptText += `\n\nPlease generate the implementation code for ${implementationPath} that will make all these tests pass. 
Remember to learn from the previous attempts and their results.
Only return valid code for the implementation file, no explanations or markdown.`;

  return promptText;
}

/**
 * Removes Markdown formatting from the generated code
 * @param code - Code possibly containing Markdown formatting
 * @returns Cleaned code
 */
function removeMarkdownFormatting(code: string): string {
  logger.debug('Cleaning Markdown formatting from code...');

  // First, try to extract code between ```typescript or ```javascript blocks
  const tsBlockRegex = /```(?:typescript|javascript|ts|js)?\s*\n([\s\S]*?)\n```/;
  const match = code.match(tsBlockRegex);

  if (match && match[1]) {
    logger.debug('Found code block with language specifier');
    return match[1].trim();
  }

  // If no language-specific block, try to extract code between any ``` blocks
  const genericBlockRegex = /```\s*\n([\s\S]*?)\n```/;
  const genericMatch = code.match(genericBlockRegex);

  if (genericMatch && genericMatch[1]) {
    logger.debug('Found generic code block');
    return genericMatch[1].trim();
  }

  // If there are ``` markers but not in the expected format, just strip them
  if (code.includes('```')) {
    logger.debug('Found ``` markers, removing them');
    return code.replace(/```(?:typescript|javascript|ts|js)?/g, '').replace(/```/g, '').trim();
  }

  // If no code blocks found, return the original code
  logger.debug('No Markdown formatting detected');
  return code;
}
export async function applyGeneratedCode(options: ApplyCodeOptions): Promise<boolean> {
  const { code, implementationPath } = options;

  if (!code || code.trim() === '') {
    logger.error('Cannot apply empty code to implementation file');
    return false;
  }

  try {
    // Make sure the directory exists
    const dir = path.dirname(implementationPath);
    logger.debug(`Ensuring directory exists: ${dir}`);
    await fs.mkdir(dir, { recursive: true });

    // Write the code to the file
    logger.info(`Writing ${code.length} characters to ${implementationPath}`);
    await fs.writeFile(implementationPath, code);

    return true;
  } catch (error) {
    logger.error('Error applying generated code:', error);
    return false;
  }
}