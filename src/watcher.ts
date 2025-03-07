// src/watcher.ts
import chokidar from 'chokidar';
import path from 'path';
import { glob } from 'glob';
import { WatcherOptions } from './types.js';
import { logger } from './utils/logger.js';

/**
 * Starts a file watcher to detect changes in test and implementation files
 * @param options - Watcher configuration
 * @returns Promise with the watcher instance
 */
export async function startWatcher(options: WatcherOptions): Promise<chokidar.FSWatcher> {
  const { projectPath, testPattern, onChange } = options;

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
        stabilityThreshold: 300,  // Wait for file size to remain stable for 300ms
        pollInterval: 100         // Poll every 100ms
      },
      atomic: true,               // Handle atomic writes properly 
      disableGlobbing: false,     // We're passing actual file paths, not globs
    });

    // Set up event handlers
    watcher.on('change', (changedFile) => {
      const relativePath = path.relative(projectPath, changedFile);
      logger.info(`File changed: ${relativePath}`);
      onChange(changedFile);
    });

    watcher.on('add', (addedFile) => {
      const relativePath = path.relative(projectPath, addedFile);
      logger.info(`File added: ${relativePath}`);
      onChange(addedFile);
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