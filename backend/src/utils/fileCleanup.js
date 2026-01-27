import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DOWNLOAD_DIR = process.env.DOWNLOAD_DIR || path.join(__dirname, '../../downloads');
const CLEANUP_INTERVAL = parseInt(process.env.CLEANUP_INTERVAL) || 21600000; // 6 hours default
const MAX_FILE_AGE = parseInt(process.env.MAX_FILE_AGE) || 86400000; // 24 hours default

/**
 * Clean up old files
 * Only deletes files that are significantly older than MAX_FILE_AGE
 * This prevents deleting files that are still being processed
 */
async function cleanupOldFiles() {
  try {
    if (!(await fs.pathExists(DOWNLOAD_DIR))) {
      return;
    }

    const files = await fs.readdir(DOWNLOAD_DIR);
    const now = Date.now();
    let cleaned = 0;

    for (const file of files) {
      const filePath = path.join(DOWNLOAD_DIR, file);
      
      try {
        const stats = await fs.stat(filePath);
        // Use the most recent time (mtime or atime) to determine if file is in use
        const lastAccess = Math.max(
          stats.mtime.getTime(),
          stats.atime.getTime() // access time
        );
        const age = now - lastAccess;

        // Only delete if file is significantly older than MAX_FILE_AGE
        // This adds a safety buffer to prevent deleting files during processing
        // Files must be at least 1.5x MAX_FILE_AGE old before deletion
        const safeDeleteAge = MAX_FILE_AGE * 1.5;
        
        if (age > safeDeleteAge) {
          try {
            await fs.remove(filePath);
            cleaned++;
            const ageHours = Math.round(age / 1000 / 60 / 60 * 10) / 10;
            console.log(`Cleaned up old file: ${file} (age: ${ageHours} hours)`);
          } catch (removeError) {
            // File might be in use, skip it
            console.log(`Could not delete file (may be in use): ${file}`);
          }
        }
      } catch (statError) {
        // File might have been deleted already, skip
        continue;
      }
    }

    if (cleaned > 0) {
      console.log(`Cleaned up ${cleaned} old file(s)`);
    }
  } catch (error) {
    console.error('Error during cleanup:', error);
  }
}

/**
 * Clean up specific files
 */
export function cleanupFiles(filePaths) {
  filePaths.forEach(async (filePath) => {
    try {
      if (await fs.pathExists(filePath)) {
        await fs.remove(filePath);
        console.log(`Cleaned up: ${filePath}`);
      }
    } catch (error) {
      console.error(`Error cleaning up ${filePath}:`, error);
    }
  });
}

/**
 * Setup automatic cleanup interval
 */
export function setupCleanup() {
  // Run cleanup immediately
  cleanupOldFiles();

  // Then run periodically
  setInterval(cleanupOldFiles, CLEANUP_INTERVAL);
  console.log(`File cleanup scheduled (interval: ${CLEANUP_INTERVAL}ms)`);
}
