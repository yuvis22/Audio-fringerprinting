import { parseFile } from 'music-metadata';
import fs from 'fs-extra';
import path from 'path';

/**
 * Extract metadata from audio file
 */
export async function extractMetadata(audioFile) {
  try {
    const stats = await fs.stat(audioFile);
    const metadata = await parseFile(audioFile);

    return {
      format: metadata.format.container || 'unknown',
      bitrate: metadata.format.bitrate || null,
      sampleRate: metadata.format.sampleRate || null,
      channels: metadata.format.numberOfChannels || null,
      duration: metadata.format.duration || null,
      fileSize: stats.size,
      fileSizeMB: (stats.size / (1024 * 1024)).toFixed(2),
      codec: metadata.format.codec || 'unknown',
      tags: metadata.common || {}
    };
  } catch (error) {
    console.error('Error extracting metadata:', error);
    // Return basic info even if metadata parsing fails
    const stats = await fs.stat(audioFile);
    return {
      format: path.extname(audioFile).slice(1),
      fileSize: stats.size,
      fileSizeMB: (stats.size / (1024 * 1024)).toFixed(2),
      error: error.message
    };
  }
}
