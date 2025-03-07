// src/types.ts

// Test runner types
export interface TestRunOptions {
  projectPath: string;
  watch?: boolean;
}

export interface TestResult {
  success: boolean;
  results?: TestResults;
  process?: any;
  error?: string;
  rawOutput?: string;
}

export interface TestResults {
  files: TestFileResult[];
  summary: TestSummary;
}

export interface TestSummary {
  total: number;
  passed: number;
  failed: number;
  duration: number;
  error?: string;
}

export interface TestFileResult {
  file: string;
  success: boolean;
  tests: TestCaseResult[];
  error?: string;
}

export interface TestCaseResult {
  name: string;
  success: boolean;
  error?: string;
  code?: string;
  duration: number;
  location?: string;
}

// AI service types
export interface GenerateOptions {
  testResults: TestFileResult;
  testCode: string;
  implementationPath: string;
  currentImplementation?: string;
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
}

export interface GenerateResult {
  success: boolean;
  code?: string;
  reasoning?: string;
  error?: string;
  message?: string;
  diagnosticInfo?: Record<string, any>;
}

export interface ApplyCodeOptions {
  code: string;
  implementationPath: string;
}

// Watcher types
export interface WatcherOptions {
  projectPath: string;
  testPattern: string;
  onChange: (changedFile: string) => void;
}

// Orchestrator types
export interface OrchestratorOptions {
  projectPath: string;
  testPattern?: string;
  maxAttempts?: number;
  onUpdate?: (update: StatusUpdate) => void;
  debugMode?: boolean;
  skipValidation?: boolean;
  onValidationIssue?: (issues: TestValidationStatus, testFilePath: string) => Promise<boolean>;
}

export interface TddAiState {
  running: boolean;
  attempts: number;
  allTestsPassing: boolean;
  history: ImplementationAttempt[];
  errors?: string[];
  diagnosticInfo?: Record<string, any>;
}

export interface ImplementationAttempt {
  timestamp: Date;
  attempt: number;
  implementation: string;
  fileUpdated?: string;
  success?: boolean;
  error?: string;
  testResults?: {
    totalTests: number;
    passingTests: number;
    failingTests: number;
    failureDetails?: Array<{
      name: string;
      error: string;
    }>;
  };
}

export type StatusUpdateType =
  | 'running_tests'
  | 'generating_code'
  | 'implementation_updated'
  | 'success'
  | 'error'
  | 'max_attempts_reached'
  | 'diagnostic_info'
  | 'validation_warning'
  | 'validation_waiting';

export interface StatusUpdate {
  status: StatusUpdateType;
  message?: string;
  file?: string;
  attempt?: number;
  maxAttempts?: number;
  timestamp?: Date;
  diagnosticInfo?: Record<string, any>;
  validationIssues?: TestValidationIssue[];
  validationAssessment?: string;
}

// Test validation types
export interface TestValidationIssue {
  severity: 'warning' | 'error';
  message: string;
  location?: string;
  suggestion?: string;
}

export interface TestValidationStatus {
  isValid: boolean;
  issues: TestValidationIssue[];
  overallAssessment: string;
  overridden: boolean;
}

// UI types
export interface UiServerOptions {
  port: number;
  projectPath: string;
}

export interface UiServer {
  stop: () => Promise<void>;
}

// Diagnostic types
export interface DiagnosticInfo {
  systemInfo: {
    nodeVersion: string;
    platform: string;
    arch: string;
    cpuCores: number;
    memoryTotal: number;
    memoryFree: number;
  };
  runtimeInfo: {
    startTime: Date;
    testRuns: number;
    generationRuns: number;
    errorCount: number;
  };
}