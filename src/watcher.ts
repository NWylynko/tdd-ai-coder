// src/watcher.ts
import chokidar from 'chokidar';
import path from 'path';
import { glob } from 'glob';
import { WatcherOptions } from './types.js';
import { logger } from './utils/logger.js';

/**
 * Debounce function to prevent multiple calls in quick succession
 */
function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout | null = null;
  return function (...args: Parameters<T>): void {
    if (timeout) {
      clearTimeout(timeout);
    }
    timeout = setTimeout(() => {
      func(...args);
      timeout = null;
    }, wait);
  };
}

/**
 * Starts a file watcher to detect changes in test and implementation files
 * @param options - Watcher configuration
 * @returns Promise with the watcher instance
 */
export async function startWatcher(options: WatcherOptions): Promise<chokidar.FSWatcher> {
  const { projectPath, testPattern, onChange } = options;

  // Debounce the onChange handler to prevent rapid successive events
  const debouncedOnChange = debounce((changedFile: string) => {
    onChange(changedFile);
  }, 300);

  logger.info(`Starting file watcher for ${projectPath} with pattern: ${testPattern}`);

  try {
    // Find all test files initially
    logger.debug(`Searching for test files matching pattern: ${testPattern}`);
    const testFiles = await glob(testPattern, {
      cwd: projectPath,
      absolute: true
    });

    logger.info(`Found ${testFiles.length} test files`);
    logger.debug('Test files:', testFiles);

    if (testFiles.length === 0) {
      logger.warn(`No test files found matching pattern: ${testPattern}`);
      logger.warn('Make sure your test files are in the correct location and match the pattern');
    }

    // Determine implementation files from test files
    const implementationFiles = testFiles.map(testFile => {
      const implFile = testFile
        .replace('.test.', '.')
        .replace('.spec.', '.');
      return implFile;
    });

    logger.debug(`Derived ${implementationFiles.length} implementation files`);

    // Create a combined pattern to watch both test and implementation files
    const combinedPattern = [
      ...testFiles,
      ...implementationFiles
    ];

    logger.info(`Watching ${combinedPattern.length} files for changes`);

    // Initialize file watcher with better settings for stability
    const watcher = chokidar.watch(combinedPattern, {
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 500,  // Increased from 300ms for better stability
        pollInterval: 100         // Poll every 100ms
      },
      atomic: true,               // Handle atomic writes properly 
      disableGlobbing: false,     // We're passing actual file paths, not globs
    });

    // Track file change timestamps to further prevent rapid duplicate events
    const fileChangeTimestamps = new Map<string, number>();

    // Set up event handlers
    watcher.on('change', (changedFile) => {
      const now = Date.now();
      const lastChange = fileChangeTimestamps.get(changedFile) || 0;

      // Ignore if the file was just changed (within 500ms)
      if (now - lastChange < 500) {
        logger.debug(`Ignoring rapid change event for ${changedFile}`);
        return;
      }

      fileChangeTimestamps.set(changedFile, now);
      const relativePath = path.relative(projectPath, changedFile);
      logger.info(`File changed: ${relativePath}`);
      debouncedOnChange(changedFile);
    });

    watcher.on('add', (addedFile) => {
      const relativePath = path.relative(projectPath, addedFile);
      logger.info(`File added: ${relativePath}`);
      debouncedOnChange(addedFile);
    });

    watcher.on('unlink', (removedFile) => {
      const relativePath = path.relative(projectPath, removedFile);
      logger.info(`File removed: ${relativePath}`);
    });

    watcher.on('error', (error) => {
      logger.error(`Watcher error: ${error}`);
    });

    // Wait for the watcher to be ready
    await new Promise<void>((resolve) => {
      watcher.on('ready', () => {
        logger.info('File watcher initialized and ready');
        resolve();
      });
    });

    return watcher;
  } catch (error) {
    logger.error('Error setting up file watcher:', error);
    throw new Error(`Failed to initialize file watcher: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Stops the file watcher
 * @param watcher - Watcher instance to stop
 */
export async function stopWatcher(watcher: chokidar.FSWatcher): Promise<void> {
  logger.info('Stopping file watcher...');

  if (!watcher) {
    logger.warn('No watcher to stop');
    return;
  }

  try {
    await watcher.close();
    logger.info('File watcher stopped successfully');
  } catch (error) {
    logger.error('Error stopping file watcher:', error);
  }
}