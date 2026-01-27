import ffmpeg from 'fluent-ffmpeg';
import { promisify } from 'util';
import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import os from 'os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DOWNLOAD_DIR = process.env.DOWNLOAD_DIR || path.join(__dirname, '../../downloads');
const SEGMENT_DURATION = parseInt(process.env.SEGMENT_DURATION) || 60; // 60 seconds per chunk

// Get CPU count for maximum parallel processing
const CPU_COUNT = os.cpus().length;
const FFMPEG_THREADS = process.env.FFMPEG_THREADS || CPU_COUNT; // Use all CPU cores
// Use even more threads for encoding (FFmpeg can use 2x CPU count efficiently)
const ENCODE_THREADS = Math.max(FFMPEG_THREADS * 2, 16); // Use 2x CPU cores or max 16

/**
 * Extract audio from video file
 */
export function extractAudio(videoFile) {
  return new Promise((resolve, reject) => {
    const audioFile = videoFile.replace(/\.[^/.]+$/, '.mp3');

    ffmpeg(videoFile)
      .outputOptions([
        `-threads ${ENCODE_THREADS}`, // Use 2x CPU cores for maximum speed!
        `-preset ultrafast`, // FASTEST encoding
        `-ac 2`, // Stereo
        `-ar 44100`, // Sample rate
        `-q:a 7` // Quality 7 (FASTEST encoding, still acceptable quality)
      ])
      .toFormat('mp3')
      .audioBitrate('96k') // EVEN LOWER bitrate = MUCH faster encoding (was 128k)
      .audioCodec('libmp3lame')
      .on('start', (commandLine) => {
        console.log(`FFmpeg using ${FFMPEG_THREADS} CPU threads for maximum speed`);
      })
      .on('progress', (progress) => {
        if (progress.percent) {
          console.log(`Audio extraction: ${Math.round(progress.percent)}% done`);
        }
      })
      .on('end', () => {
        console.log('Audio extraction finished');
        resolve(audioFile);
      })
      .on('error', (err) => {
        console.error('FFmpeg error:', err);
        reject(new Error(`Audio extraction failed: ${err.message}`));
      })
      .save(audioFile);
  });
}

/**
 * Split audio into segments for analysis
 */
export function splitAudioSegments(audioFile) {
  return new Promise((resolve, reject) => {
    const segments = [];
    const audioPath = path.parse(audioFile);
    const segmentPattern = path.join(audioPath.dir, `${audioPath.name}_segment_%03d.mp3`);

    // First, get audio duration
    ffmpeg.ffprobe(audioFile, (err, metadata) => {
      if (err) {
        return reject(new Error(`Failed to probe audio: ${err.message}`));
      }

      const duration = metadata.format.duration;
      const segmentCount = Math.ceil(duration / SEGMENT_DURATION);

      // Split audio (using -c copy for speed - no re-encoding!)
      ffmpeg(audioFile)
        .outputOptions([
          `-threads ${FFMPEG_THREADS}`, // Use all CPU cores!
          `-f segment`,
          `-segment_time ${SEGMENT_DURATION}`,
          `-c copy`, // Copy codec - no re-encoding = much faster!
          `-reset_timestamps 1`,
          `-segment_format mp3` // Ensure MP3 format
        ])
        .output(segmentPattern)
        .on('start', (commandLine) => {
          console.log(`Splitting audio with ${FFMPEG_THREADS} CPU threads (fast mode - no re-encoding)...`);
        })
        .on('end', () => {
          // Collect segment files immediately
          for (let i = 0; i < segmentCount; i++) {
            const segmentFile = segmentPattern.replace('%03d', String(i).padStart(3, '0'));
            if (fs.existsSync(segmentFile)) {
              segments.push(segmentFile);
            }
          }
          console.log(`Created ${segments.length} segments`);
          resolve(segments);
        })
        .on('error', (err) => {
          console.error('Segment split error:', err);
          reject(new Error(`Failed to split audio: ${err.message}`));
        })
        .run();
    });
  });
}
