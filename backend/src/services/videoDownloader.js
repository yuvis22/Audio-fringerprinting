import ytdl from 'ytdl-core';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import ffmpeg from 'fluent-ffmpeg';
import os from 'os';
import http from 'http';
import https from 'https';

// Add local bin to PATH for aria2c
const __filename_init = fileURLToPath(import.meta.url);
const __dirname_init = dirname(__filename_init);
const localBin = path.resolve(__dirname_init, '../../bin');
if (!process.env.PATH.includes(localBin)) {
  process.env.PATH = `${localBin}:${process.env.PATH}`;
}

// Custom execAsync with increased buffer size for yt-dlp output
const execAsync = (command, options = {}) => {
  return new Promise((resolve, reject) => {
    exec(command, {
      maxBuffer: 100 * 1024 * 1024, // 100MB buffer (increased)
      ...options
    }, (error, stdout, stderr) => {
      if (error) {
        reject(error);
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
};

// Better execAsync using spawn for large outputs
const execAsyncSpawn = (command, args = [], options = {}) => {
  return new Promise((resolve, reject) => {
    const parts = command.split(' ');
    const cmd = parts[0];
    const cmdArgs = [...parts.slice(1), ...args];
    
    let stdout = '';
    let stderr = '';
    
    const process = spawn(cmd, cmdArgs, {
      ...options,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    
    process.stdout.on('data', (data) => {
      stdout += data.toString();
    });
    
    process.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    
    process.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Process exited with code ${code}: ${stderr}`));
      } else {
        resolve({ stdout, stderr });
      }
    });
    
    process.on('error', (error) => {
      reject(error);
    });
  });
};

// Helper function to parse yt-dlp progress output
function parseProgressOutput(output, progressCallback) {
  // Try multiple progress formats
  // Format 1: [download] 45.2% of 5.23MiB at 2.15MiB/s ETA 00:01
  // Format 2: [download] 100% of 5.23MiB
  // Format 3: 45.2%
  // Format 4: [ExtractAudio] Destination: ... (post-processing)
  
  // Skip post-processing messages
  if (output.includes('[ExtractAudio]') || output.includes('[Merger]')) {
    return;
  }
  
  let match = output.match(/\[download\]\s+(\d+\.?\d*)%/);
  if (!match) {
    match = output.match(/\[download\]\s+(\d+)%/); // Integer percentage
  }
  if (!match) {
    match = output.match(/(\d+\.?\d*)%\s+of/); // Percentage with "of" after
  }
  if (!match) {
    match = output.match(/(\d+\.?\d*)%/); // Just percentage anywhere
  }
  
  if (match) {
    const progress = parseFloat(match[1]);
    if (!isNaN(progress) && progress >= 0 && progress <= 100) {
      progressCallback(Math.min(100, Math.max(0, progress))); // Clamp 0-100
    }
  }
}

// Exec with progress tracking for yt-dlp
const execAsyncSpawnWithProgress = (command, args = [], progressCallback = null) => {
  return new Promise((resolve, reject) => {
    const parts = command.split(' ');
    const cmd = parts[0];
    const cmdArgs = [...parts.slice(1), ...args];
    
    let stdout = '';
    let stderr = '';
    
    const process = spawn(cmd, cmdArgs, {
      stdio: ['ignore', 'pipe', 'pipe']
    });
    
    process.stdout.on('data', (data) => {
      const output = data.toString();
      stdout += output;
      
      // Parse yt-dlp progress output
      if (progressCallback) {
        parseProgressOutput(output, progressCallback);
      }
    });
    
    process.stderr.on('data', (data) => {
      const output = data.toString();
      stderr += output;
      
      // yt-dlp outputs progress to stderr (main output)
      if (progressCallback) {
        // Debug: log raw output to see what we're getting
        if (output.includes('[download]') || output.includes('%')) {
          console.log(`[yt-dlp stderr]: ${output.trim()}`);
        }
        parseProgressOutput(output, progressCallback);
      }
    });
    
    process.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Process exited with code ${code}: ${stderr}`));
      } else {
        resolve({ stdout, stderr });
      }
    });
    
    process.on('error', (error) => {
      reject(error);
    });
  });
};
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DOWNLOAD_DIR = process.env.DOWNLOAD_DIR || path.join(__dirname, '../../downloads');
const MAX_DURATION = parseInt(process.env.MAX_VIDEO_DURATION) || 3600; // 1 hour default

// Segment-based download settings for FAST music identification
// Unified via env var so other modules can read the same value
const SEGMENT_DURATION = parseInt(process.env.SEGMENT_DURATION) || 15; // 15s per segment (better for ACRCloud)
const NUM_SEGMENTS = parseInt(process.env.NUM_SEGMENTS) || 6; // Number of segments to attempt

// URL cache to prevent re-downloads (expires after 1 hour)
const urlCache = new Map();
const CACHE_DURATION = 3600000; // 1 hour in milliseconds

// Ensure download directory exists
fs.ensureDirSync(DOWNLOAD_DIR);

/**
 * Check URL cache for recent downloads
 */
function getCachedInfo(url) {
  const cached = urlCache.get(url);
  if (cached && (Date.now() - cached.timestamp) < CACHE_DURATION) {
    console.log('✅ Using cached video info');
    return cached.data;
  }
  urlCache.delete(url); // Remove expired cache
  return null;
}

/**
 * Cache video info
 */
function cacheVideoInfo(url, data) {
  urlCache.set(url, {
    data,
    timestamp: Date.now()
  });
}

/**
 * Calculate smart segment positions based on video duration
 * Returns array of {start, end} timestamps in seconds
 */
function calculateSegmentPositions(duration) {
  const segments = [];
  
  if (duration <= SEGMENT_DURATION) {
    // Video is too short, just use the whole video
    return [{ start: 0, end: duration }];
  }
  // Strategy: Provide dense coverage for the first minute (common place for inserted clips)
  // then sample a few positions across the rest of the video. This increases chance
  // of catching short inserted songs (like 0:30-0:47) while keeping total download small.

  const added = new Set();

  // Dense sampling of the first 60 seconds (or up to duration)
  const earlyWindow = Math.min(60, duration);
  for (let t = 0; t < earlyWindow; t += SEGMENT_DURATION) {
    const start = t;
    const end = Math.min(t + SEGMENT_DURATION, duration);
    if (end - start >= 5) {
      const key = `${start}-${end}`;
      if (!added.has(key)) {
        segments.push({ start, end });
        added.add(key);
      }
      if (segments.length >= NUM_SEGMENTS) return segments;
    }
  }

  // If we still have slots, sample spread positions across the video
  const spreadPoints = [0.25, 0.5, 0.85];
  for (const frac of spreadPoints) {
    if (segments.length >= NUM_SEGMENTS) break;
    const pos = Math.floor(duration * frac);
    const start = Math.max(0, pos - Math.floor(SEGMENT_DURATION / 2));
    const end = Math.min(start + SEGMENT_DURATION, duration);
    if (end - start >= 5) {
      const key = `${start}-${end}`;
      if (!added.has(key)) {
        segments.push({ start, end });
        added.add(key);
      }
    }
  }

  // If still not enough, evenly space remaining segments
  let i = 0;
  while (segments.length < NUM_SEGMENTS && i < NUM_SEGMENTS * 2) {
    const pos = Math.floor((duration / NUM_SEGMENTS) * i);
    const start = Math.max(0, pos);
    const end = Math.min(start + SEGMENT_DURATION, duration);
    const key = `${start}-${end}`;
    if (end - start >= 5 && !added.has(key)) {
      segments.push({ start, end });
      added.add(key);
    }
    i++;
  }
  
  return segments;
}

/**
 * Format time in HH:MM:SS format for yt-dlp
 */
function formatTime(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Check if URL is a direct video file
 */
function isDirectVideoFile(url) {
  const videoExtensions = ['.mp4', '.webm', '.mkv', '.avi', '.mov', '.flv', '.m4v', '.3gp', '.mp3', '.wav', '.m4a', '.aac', '.ogg', '.wma'];
  const lowerUrl = url.toLowerCase();
  return videoExtensions.some(ext => lowerUrl.includes(ext));
}

/**
 * Detect platform from URL
 */
function detectPlatform(url) {
  if (url.includes('youtube.com') || url.includes('youtu.be')) {
    return 'youtube';
  } else if (url.includes('vimeo.com')) {
    return 'vimeo';
  } else if (url.includes('tiktok.com')) {
    return 'tiktok';
  } else if (url.includes('instagram.com')) {
    return 'instagram';
  } else {
    return 'unknown';
  }
}

/**
 * Get video info quickly without downloading (using yt-dlp)
 * FAST - only fetches metadata, no download!
 */
async function getVideoInfo(url) {
  // Check cache first
  const cached = getCachedInfo(url);
  if (cached) {
    return cached;
  }

  try {
    // If URL is a direct video file, try probing with ffprobe first (no yt-dlp needed)
    if (isDirectVideoFile(url)) {
      try {
        const metadata = await new Promise((resolve, reject) => {
          ffmpeg.ffprobe(url, (err, metadata) => {
            if (err) reject(err);
            else resolve(metadata);
          });
        });

        const duration = metadata?.format?.duration || 0;
        const videoInfo = {
          title: path.basename(new URL(url).pathname) || 'Video',
          duration: Math.round(duration),
          uploader: 'Unknown',
          uploadDate: '',
          description: '',
          thumbnail: '',
          webpageUrl: url,
          platform: 'direct'
        };

        cacheVideoInfo(url, videoInfo);
        return videoInfo;
      } catch (err) {
        // If ffprobe fails for remote URL, fall back to yt-dlp logic below
        console.warn('ffprobe failed for direct URL, falling back to yt-dlp:', err.message || err);
      }
    }
    // Check if yt-dlp is available
    let ytDlpCommand = 'yt-dlp';
    let ytDlpArgs = [];
    const checkCommand = process.platform === 'win32' ? 'where' : 'which';
    
    try {
      await execAsyncSpawn(checkCommand, ['yt-dlp']);
    } catch {
      // Try python3 -m yt_dlp as fallback (preferred on linux/mac)
      try {
        await execAsyncSpawn('python3', ['-m', 'yt_dlp', '--version']);
        ytDlpCommand = 'python3';
        ytDlpArgs = ['-m', 'yt_dlp'];
      } catch {
        // Try python -m yt_dlp as fallback (windows)
        try {
          await execAsyncSpawn('python', ['-m', 'yt_dlp', '--version']);
          ytDlpCommand = 'python';
          ytDlpArgs = ['-m', 'yt_dlp'];
        } catch {
          throw new Error('yt-dlp is not installed');
        }
      }
    }

    // Get video info FAST (no download!)
    const { stdout: infoJson } = await execAsyncSpawn(ytDlpCommand, [
      ...ytDlpArgs,
      '--quiet',
      '--no-warnings',
      '--dump-json',
      '--no-download',
      '--no-playlist',
      url
    ]);
    
    const info = JSON.parse(infoJson);
    
    // Check duration
    if (info.duration > MAX_DURATION) {
      throw new Error(`Video too long (${info.duration}s). Maximum allowed: ${MAX_DURATION}s`);
    }

    const videoInfo = {
      title: info.title,
      duration: info.duration,
      uploader: info.uploader || info.channel || 'Unknown',
      uploadDate: info.upload_date || '',
      description: info.description || '',
      thumbnail: info.thumbnail || '',
      webpageUrl: info.webpage_url || url,
      platform: detectPlatform(url)
    };

    // Cache the info
    cacheVideoInfo(url, videoInfo);
    
    return videoInfo;
  } catch (error) {
    throw new Error(`Failed to get video info: ${error.message}`);
  }
}

/**
 * Download specific time segment from video as audio
 * SUPER FAST - only downloads 10 seconds instead of full video!
 * 
 * @param {string} url - Video URL
 * @param {number} startTime - Start time in seconds
 * @param {number} endTime - End time in seconds
 * @param {number} segmentIndex - Segment index for tracking
 * @param {string} title - Video title for filename
 */
async function downloadAudioSegment(url, startTime, endTime, segmentIndex, title) {
  try {
    // Check if yt-dlp is available
    let ytDlpCommand = 'yt-dlp';
    let ytDlpArgs = [];
    const checkCommand = process.platform === 'win32' ? 'where' : 'which';
    
    try {
      await execAsyncSpawn(checkCommand, ['yt-dlp']);
    } catch {
      try {
        await execAsyncSpawn('python3', ['-m', 'yt_dlp', '--version']);
        ytDlpCommand = 'python3';
        ytDlpArgs = ['-m', 'yt_dlp'];
      } catch {
        try {
          await execAsyncSpawn('python', ['-m', 'yt_dlp', '--version']);
          ytDlpCommand = 'python';
          ytDlpArgs = ['-m', 'yt_dlp'];
        } catch {
          throw new Error('yt-dlp is not installed');
        }
      }
    }

    const safeTitle = title ? title.replace(/[^a-z0-9]/gi, '_').substring(0, 50) : uuidv4();
    const filename = `${safeTitle}_segment${segmentIndex}_${startTime}-${endTime}.mp3`;
    const outputPath = path.join(DOWNLOAD_DIR, filename);

    console.log(`⚡ Downloading segment ${segmentIndex}: ${startTime}s - ${endTime}s (${endTime - startTime}s)`);

    // If URL is a direct video file (like your Backblaze .mp4 link), use ffmpeg to extract
    // the audio segment directly from the remote file. This avoids downloading the whole file
    // and is much faster when the server supports range requests.
    if (isDirectVideoFile(url)) {
      console.log('Using ffmpeg direct extraction for direct video URL');
      await new Promise((resolve, reject) => {
        ffmpeg(url)
          .inputOptions([`-ss ${startTime}`])
          .setDuration(endTime - startTime)
          .noVideo()
          .audioCodec('libmp3lame')
          .audioBitrate('96k')
          .outputOptions(['-threads 2'])
          .on('end', () => {
            console.log(`✅ Segment ${segmentIndex} extracted via ffmpeg: ${path.basename(outputPath)}`);
            resolve();
          })
          .on('error', (err) => {
            console.error('ffmpeg extraction error:', err.message || err);
            reject(err);
          })
          .save(outputPath);
      });

      if (!(await fs.pathExists(outputPath))) {
        throw new Error(`Segment file not created by ffmpeg: ${outputPath}`);
      }

      return outputPath;
    }

    // Otherwise fall back to yt-dlp segment download
    const downloadArgs = [
      ...ytDlpArgs,
      '--quiet',
      '--no-warnings',
      '--no-playlist',
      '--download-sections', `*${formatTime(startTime)}-${formatTime(endTime)}`,
      '-x',
      '--audio-format', 'mp3',
      '--audio-quality', '96K',
      '--format', 'bestaudio/best',
      '--extractor-args', 'youtube:player_client=android',
      '--no-part',
      '--no-mtime',
      '--postprocessor-args', 'ffmpeg:-threads 2',
      '-o', outputPath,
      url
    ];

    await execAsyncSpawn(ytDlpCommand, downloadArgs);

    // Verify file exists
    if (!(await fs.pathExists(outputPath))) {
      throw new Error(`Segment file not created: ${outputPath}`);
    }

    console.log(`✅ Segment ${segmentIndex} downloaded: ${path.basename(outputPath)}`);
    return outputPath;

  } catch (error) {
    console.error(`❌ Failed to download segment ${segmentIndex}:`, error.message);
    throw error;
  }
}

/**
 * Download multiple segments in PARALLEL for MAXIMUM speed!
 * Downloads 4 segments (10 sec each) = 40 sec total instead of 10 min video!
 * 10-20x FASTER! ⚡⚡⚡
 */
async function downloadAudioSegments(url, videoInfo, progressCallback) {
  const { duration, title } = videoInfo;
  
  // Calculate smart segment positions
  const segmentPositions = calculateSegmentPositions(duration);
  console.log(`📊 Video duration: ${duration}s, downloading ${segmentPositions.length} segments`);
  
  const totalSegments = segmentPositions.length;
  let completed = 0;

  // Download ALL segments in PARALLEL - MAXIMUM SPEED!
  const downloadPromises = segmentPositions.map((segment, index) => {
    return downloadAudioSegment(url, segment.start, segment.end, index, title)
      .then(filePath => {
        completed++;
        if (progressCallback) {
          const progress = Math.round((completed / totalSegments) * 100);
          progressCallback(progress);
        }
        return {
          file: filePath,
          startTime: segment.start,
          endTime: segment.end,
          segmentIndex: index
        };
      })
      .catch(error => {
        console.error(`Segment ${index} failed, continuing with others...`);
        return null;
      });
  });

  // Wait for ALL segments to download in parallel
  const results = await Promise.all(downloadPromises);
  
  // Filter out failed segments
  const successfulSegments = results.filter(Boolean);
  
  if (successfulSegments.length === 0) {
    throw new Error('All segments failed to download');
  }

  console.log(`✅ Downloaded ${successfulSegments.length}/${totalSegments} segments successfully`);
  return successfulSegments;
}

/**
 * Download direct video file (MP4, WebM, etc.)
 */
async function downloadDirectFile(url) {
  try {
    // Prefer extracting audio directly from remote file via ffmpeg (no full video download)
    const urlPath = new URL(url).pathname;
    const safeBase = path.basename(urlPath) || uuidv4();
    const title = safeBase.replace(/\.[^.]+$/, '');
    const audioFilename = `${uuidv4()}.mp3`;
    const audioFile = path.join(DOWNLOAD_DIR, audioFilename);

    try {
      console.log('Attempting ffmpeg remote extraction for direct video URL');
      await new Promise((resolve, reject) => {
        ffmpeg(url)
          .noVideo()
          .audioCodec('libmp3lame')
          .audioBitrate('96k')
          .outputOptions(['-threads 0'])
          .on('end', () => {
            console.log(`Extracted audio to ${audioFile}`);
            resolve();
          })
          .on('error', (err) => {
            console.error('ffmpeg remote extraction failed:', err.message || err);
            reject(err);
          })
          .save(audioFile);
      });

      // Verify and probe audio
      if (await fs.pathExists(audioFile)) {
        try {
          const metadata = await new Promise((resolve, reject) => {
            ffmpeg.ffprobe(audioFile, (err, metadata) => {
              if (err) reject(err);
              else resolve(metadata);
            });
          });

          const duration = Math.round(metadata.format.duration || 0);
          if (duration > MAX_DURATION) {
            // remove audio if too long
            await fs.remove(audioFile);
            throw new Error(`Audio extracted is too long (${duration}s). Maximum allowed: ${MAX_DURATION}s`);
          }

          return {
            audioFile,
            title: title || 'Video',
            duration,
            uploader: 'Unknown',
            uploadDate: '',
            description: '',
            thumbnail: '',
            webpageUrl: url,
            platform: 'direct'
          };
        } catch (probeErr) {
          // If probe fails, still return audioFile
          return {
            audioFile,
            title: title || 'Video',
            duration: 0,
            uploader: 'Unknown',
            uploadDate: '',
            description: '',
            thumbnail: '',
            webpageUrl: url,
            platform: 'direct'
          };
        }
      }

      throw new Error('ffmpeg extraction did not produce an audio file');
    } catch (ffmpegErr) {
      console.warn('ffmpeg remote extraction failed, falling back to full download:', ffmpegErr.message || ffmpegErr);
      // Fallback to previous behavior: download full video file then probe
      const ext = path.extname(urlPath) || '.mp4';
      const filename = `${uuidv4()}${ext}`;
      const videoFile = path.join(DOWNLOAD_DIR, filename);

      // Download the file with axios (existing behavior)
      const response = await axios({
        method: 'GET',
        url: url,
        responseType: 'stream',
        timeout: 300000,
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
        maxRedirects: 5,
        httpAgent: new http.Agent({ keepAlive: true }),
        httpsAgent: new https.Agent({ keepAlive: true })
      });

      const writer = fs.createWriteStream(videoFile);
      response.data.pipe(writer);

      return await new Promise((resolve, reject) => {
        writer.on('finish', async () => {
          try {
            const metadata = await new Promise((resolve, reject) => {
              ffmpeg.ffprobe(videoFile, (err, metadata) => {
                if (err) reject(err);
                else resolve(metadata);
              });
            });

            const duration = metadata.format.duration || 0;
            if (duration > MAX_DURATION) {
              await fs.remove(videoFile);
              throw new Error(`Video too long (${duration}s). Maximum allowed: ${MAX_DURATION}s`);
            }

            resolve({
              videoFile,
              title: title || 'Video',
              duration: Math.round(duration),
              uploader: 'Unknown',
              uploadDate: '',
              description: '',
              thumbnail: '',
              webpageUrl: url,
              platform: 'direct'
            });
          } catch (error) {
            resolve({
              videoFile,
              title: title || 'Video',
              duration: 0,
              uploader: 'Unknown',
              uploadDate: '',
              description: '',
              thumbnail: '',
              webpageUrl: url,
              platform: 'direct'
            });
          }
        });

        writer.on('error', reject);
        response.data.on('error', reject);
      });
    }
  } catch (error) {
    throw new Error(`Failed to download direct file: ${error.message}`);
  }
}

/**
 * Download audio directly using yt-dlp (supports multiple platforms)
 * Downloads FULL file at once with MAXIMUM parallelization (64 fragments + aria2c = 100% network!)
 * Downloads only audio - much faster and uses less storage!
 * 
 * NOTE: Audio splitting happens AFTER download (for music identification), not during download.
 * The download itself downloads the complete file in one go with maximum speed.
 * 
 * @param {string} url - Video URL
 * @param {Function} progressCallback - Callback function(progress: number) for download progress 0-100
 */
async function downloadWithYtDlp(url, progressCallback = null) {
  // Download directly as MP3 - no video needed!
  const outputPath = path.join(DOWNLOAD_DIR, `%(title)s.%(ext)s`);
  
  try {
    // Check if yt-dlp is available and determine the command to use
    let ytDlpCommand = 'yt-dlp';
    let ytDlpArgs = [];
    const checkCommand = process.platform === 'win32' ? 'where' : 'which';
    
    try {
      await execAsyncSpawn(checkCommand, ['yt-dlp']);
      console.log('✅ yt-dlp found in PATH');
    } catch {
      // Try python3 -m yt_dlp as fallback (linux/mac)
      try {
        await execAsyncSpawn('python3', ['-m', 'yt_dlp', '--version']);
        ytDlpCommand = 'python3';
        ytDlpArgs = ['-m', 'yt_dlp'];
        console.log('✅ yt-dlp found via python3 -m yt_dlp');
      } catch {
        // Try python -m yt_dlp as fallback (windows)
        try {
          await execAsyncSpawn('python', ['-m', 'yt_dlp', '--version']);
          ytDlpCommand = 'python';
          ytDlpArgs = ['-m', 'yt_dlp'];
          console.log('✅ yt-dlp found via python -m yt_dlp');
        } catch {
          const installInstructions = process.platform === 'win32' 
            ? 'pip install yt-dlp or download from https://github.com/yt-dlp/yt-dlp/releases'
            : 'brew install yt-dlp or pip3 install yt-dlp';
          throw new Error(`yt-dlp is not installed. Please install it: ${installInstructions}`);
        }
      }
    }
    
    // Check if aria2c is available (for maximum speed) - if not, yt-dlp will fallback automatically
    let hasAria2c = false;
    try {
      await execAsyncSpawn(checkCommand, ['aria2c']);
      hasAria2c = true;
      console.log('✅ aria2c found - using MAXIMUM speed download (64 parallel connections + 128 fragments = BLAZING FAST!)');
    } catch {
      console.warn('⚠️  aria2c not found - will use yt-dlp built-in downloader (still fast with 128 fragments)');
      const aria2cInstall = process.platform === 'win32'
        ? 'Download from https://github.com/aria2/aria2/releases'
        : 'brew install aria2';
      console.warn(`   Install aria2c for even faster downloads: ${aria2cInstall}`);
    }

    // First, get video info
    const { stdout: infoJson } = await execAsyncSpawn(ytDlpCommand, [
      ...ytDlpArgs,
      '--quiet',
      '--no-warnings',
      '--dump-json',
      '--no-download',
      url
    ]);
    const info = JSON.parse(infoJson);

    // Check duration
    if (info.duration > MAX_DURATION) {
      throw new Error(`Video too long (${info.duration}s). Maximum allowed: ${MAX_DURATION}s`);
    }

    // Download ONLY audio - MAXIMUM PARALLEL DOWNLOAD (64 fragments + aria2c = 100% network usage!)
    // Downloads full file at once with maximum speed using all available bandwidth
    // Track progress if callback provided
    const downloadArgs = [
      ...(progressCallback ? [] : ['--quiet']), // Only use --quiet if we don't need progress
      '--no-warnings',
      progressCallback ? '--progress' : '--no-progress', // Show progress if callback provided
      ...(progressCallback ? ['--newline'] : []), // One progress line per update
      '--concurrent-fragments', '128', // 128 PARALLEL fragments = MAXIMUM speed! (was 1 = sequential = SLOW)
      '--fragment-retries', '2', // Faster retries
      '--retries', '2', // Faster retries
      '--socket-timeout', '10', // Faster timeout
      '--http-chunk-size', '50M', // 50MB chunks for MAXIMUM speed! (was 20M)
      '-x', // Extract audio only
      '--audio-format', 'mp3', // Convert to MP3
      '--audio-quality', '96K', // Lower quality = faster encoding
      '--format', 'bestaudio/best', // Get best quality audio format available (faster than converting)
      '--postprocessor-args', 'ffmpeg:-threads 0', // Use all CPU cores
      '--extractor-args', 'youtube:player_client=android', // Use faster extractor
      // Use aria2c for MAXIMUM speed - 16 parallel connections (max allowed)
      // If aria2c not available, yt-dlp will automatically fallback to built-in downloader
      ...(hasAria2c ? [
        '--external-downloader', 'aria2c',
        '--external-downloader-args', 'aria2c:-x 16 -s 16 -j 16 -k 5M --max-connection-per-server=16 --min-split-size=1M --split=16'
      ] : []),
      '--no-part', // Don't use .part files (faster)
      '--no-mtime', // Skip mtime (faster)
      '--no-write-thumbnail', // Skip thumbnail (faster)
      '--no-write-info-json', // Skip info json (faster)
      '--no-playlist', // Skip playlists (faster)
      '--no-colors', // No colors in output (faster)
      '-o', outputPath,
      url
    ];

    // If progress callback provided, track download progress
    if (progressCallback) {
      await execAsyncSpawnWithProgress(ytDlpCommand, [...ytDlpArgs, ...downloadArgs], progressCallback);
    } else {
      await execAsyncSpawn(ytDlpCommand, [...ytDlpArgs, ...downloadArgs]);
    }

    // Find the downloaded audio file (now it's already MP3!)
    const title = info.title.replace(/[^a-z0-9]/gi, '_').substring(0, 100);
    const audioFile = path.join(DOWNLOAD_DIR, `${title}.mp3`);
    
    // Wait for file to be written (reduced wait time for faster response)
    let retries = 20; // More retries but shorter wait
    while (retries > 0 && !(await fs.pathExists(audioFile))) {
      await new Promise(resolve => setTimeout(resolve, 100)); // Reduced from 500ms to 100ms
      retries--;
    }

    if (!(await fs.pathExists(audioFile))) {
      // Try to find any MP3 file in download dir
      const files = await fs.readdir(DOWNLOAD_DIR);
      const recentFile = files
        .filter(f => f.endsWith('.mp3'))
        .map(f => path.join(DOWNLOAD_DIR, f))
        .sort((a, b) => fs.statSync(b).mtime - fs.statSync(a).mtime)[0];
      
      if (recentFile) {
        return {
          audioFile: recentFile, // Return audio file directly!
          title: info.title,
          duration: info.duration,
          uploader: info.uploader || info.channel || 'Unknown',
          uploadDate: info.upload_date || '',
          description: info.description || '',
          thumbnail: info.thumbnail || '',
          webpageUrl: info.webpage_url || url,
          platform: detectPlatform(url)
        };
      }
      
      throw new Error('Downloaded audio file not found');
    }

    return {
      audioFile, // Return audio file directly - no video needed!
      title: info.title,
      duration: info.duration,
      uploader: info.uploader || info.channel || 'Unknown',
      uploadDate: info.upload_date || '',
      description: info.description || '',
      thumbnail: info.thumbnail || '',
      webpageUrl: info.webpage_url || url,
      platform: detectPlatform(url)
    };
  } catch (error) {
    throw new Error(`Failed to download video: ${error.message}`);
  }
}

/**
 * Download audio from YouTube using node-ytdl-core (faster for YouTube only)
 * Downloads only audio - no video needed!
 */
async function downloadYouTube(url) {
  try {
    const info = await ytdl.getInfo(url);
    
    if (info.videoDetails.lengthSeconds > MAX_DURATION) {
      throw new Error(`Video too long (${info.videoDetails.lengthSeconds}s). Maximum allowed: ${MAX_DURATION}s`);
    }

    const title = info.videoDetails.title.replace(/[^a-z0-9]/gi, '_').substring(0, 100);
    const audioFile = path.join(DOWNLOAD_DIR, `${title}.mp3`);

    return new Promise((resolve, reject) => {
      // Download only audio stream with 5G SPEED (100+ Mbps)
      const audioStream = ytdl(url, {
        quality: 'highestaudio',
        filter: 'audioonly',
        highWaterMark: 1024 * 1024 * 512, // 512MB buffer (was 128MB) - 5G speed!
        requestOptions: {
          maxRedirects: 5,
          timeout: 5000, // 5s timeout (faster)
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': '*/*',
            'Accept-Encoding': 'identity', // No compression for speed
            'Connection': 'keep-alive'
          },
          // UNLIMITED connections - ALL at once for MAXIMUM speed!
          agent: new https.Agent({
            keepAlive: true,
            keepAliveMsecs: 60000, // Keep alive longer
            maxSockets: Infinity, // UNLIMITED connections - ALL at once!
            maxFreeSockets: Infinity,
            scheduling: 'fifo'
          })
        }
      });

      // Convert to MP3 using ffmpeg with MAXIMUM CPU cores
      const cpuCount = os.cpus().length;
      const encodeThreads = Math.max(cpuCount * 2, 16); // Use 2x CPU cores
      const ffmpegProcess = ffmpeg(audioStream)
        .outputOptions([
          `-threads ${encodeThreads}`, // Use 2x CPU cores for maximum speed!
          `-preset ultrafast`, // FASTEST encoding
          `-q:a 7` // Quality 7 (FASTEST encoding)
        ])
        .toFormat('mp3')
        .audioBitrate('96k') // EVEN LOWER bitrate = MUCH faster encoding
        .audioCodec('libmp3lame')
        .on('end', () => {
          resolve({
            audioFile, // Return audio file directly!
            title: info.videoDetails.title,
            duration: parseInt(info.videoDetails.lengthSeconds),
            uploader: info.videoDetails.author.name,
            uploadDate: info.videoDetails.publishDate || '',
            description: info.videoDetails.description || '',
            thumbnail: info.videoDetails.thumbnails[info.videoDetails.thumbnails.length - 1]?.url || '',
            webpageUrl: url,
            platform: 'youtube'
          });
        })
        .on('error', reject)
        .save(audioFile);
    });
  } catch (error) {
    throw new Error(`Failed to download YouTube audio: ${error.message}`);
  }
}

/**
 * FAST segment-based download for music identification
 * Downloads ONLY small segments (40 sec) instead of full video (10 min)
 * 10-20x FASTER! ⚡⚡⚡
 * 
 * @param {string} url - Video URL
 * @param {Function} progressCallback - Optional callback for download progress (0-100)
 * @returns {Object} - { videoInfo, segmentFiles: [{file, startTime, endTime}] }
 */
export async function downloadVideoSegments(url, progressCallback = null) {
  try {
    console.log('🚀 FAST MODE: Downloading segments for music identification...');
    
    // Step 1: Get video info FAST (no download - just metadata)
    if (progressCallback) progressCallback(10);
    const videoInfo = await getVideoInfo(url);
    console.log(`📹 Video: "${videoInfo.title}" (${videoInfo.duration}s)`);
    
    // Step 2: Download smart segments in PARALLEL (40 sec total)
    if (progressCallback) progressCallback(20);
    const segmentFiles = await downloadAudioSegments(url, videoInfo, (segProgress) => {
      // Map segment progress (0-100) to overall progress (20-100)
      if (progressCallback) {
        const overall = 20 + Math.round(segProgress * 0.8);
        progressCallback(overall);
      }
    });
    
    if (progressCallback) progressCallback(100);
    
    console.log(`✅ FAST MODE COMPLETE: Downloaded ${segmentFiles.length} segments (${segmentFiles.length * 10}s total)`);
    
    return {
      videoInfo,
      segmentFiles,
      mode: 'segments'
    };
    
  } catch (error) {
    console.error('❌ Segment download failed:', error.message);
    throw new Error(`Failed to download segments: ${error.message}`);
  }
}

/**
 * Full video/audio download (FALLBACK - slower but gets everything)
 * Use this only if segment-based download fails or user requests full audio
 * 
 * @param {string} url - Video URL
 * @param {Function} progressCallback - Optional callback for download progress (0-100)
 */
export async function downloadFullAudio(url, progressCallback = null) {
  console.log('📥 FULL MODE: Downloading complete audio (slower)...');
  
  // Check if it's a direct video file
  if (isDirectVideoFile(url)) {
    console.log('Detected direct video file, downloading directly...');
    return await downloadDirectFile(url);
  }

  // ALWAYS use yt-dlp with MAXIMUM parallelization
  return await downloadWithYtDlp(url, progressCallback);
}

/**
 * Main download function - auto-detects platform
 * NOW USES FAST SEGMENT MODE BY DEFAULT! ⚡
 * 
 * @param {string} url - Video URL
 * @param {Function} progressCallback - Optional callback for download progress (0-100)
 * @param {Object} options - { mode: 'segments' | 'full' } (default: 'segments')
 */
export async function downloadVideo(url, progressCallback = null, options = {}) {
  const mode = options.mode || 'segments'; // Default to FAST mode!
  
  if (mode === 'segments') {
    // FAST MODE: Download only segments (default)
    return await downloadVideoSegments(url, progressCallback);
  } else {
    // FULL MODE: Download complete audio (fallback)
    return await downloadFullAudio(url, progressCallback);
  }
}
