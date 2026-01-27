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

// Ensure download directory exists
fs.ensureDirSync(DOWNLOAD_DIR);

/**
 * Check if URL is a direct video file
 */
function isDirectVideoFile(url) {
  const videoExtensions = ['.mp4', '.webm', '.mkv', '.avi', '.mov', '.flv', '.m4v', '.3gp'];
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
 * Download direct video file (MP4, WebM, etc.)
 */
async function downloadDirectFile(url) {
  try {
    // Get file extension from URL
    const urlPath = new URL(url).pathname;
    const ext = path.extname(urlPath) || '.mp4';
    const filename = `${uuidv4()}${ext}`;
    const videoFile = path.join(DOWNLOAD_DIR, filename);

    // Download the file with 5G SPEED settings (100+ Mbps)
    const response = await axios({
      method: 'GET',
      url: url,
      responseType: 'stream',
      timeout: 300000, // 5 minutes timeout
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
      maxRedirects: 5,
      // UNLIMITED connections - ALL at once for MAXIMUM speed!
      httpAgent: new http.Agent({
        keepAlive: true,
        keepAliveMsecs: 60000, // Keep alive longer
        maxSockets: Infinity, // UNLIMITED connections - ALL at once!
        maxFreeSockets: Infinity,
        scheduling: 'fifo' // First in first out
      }),
      httpsAgent: new https.Agent({
        keepAlive: true,
        keepAliveMsecs: 60000, // Keep alive longer
        maxSockets: Infinity, // UNLIMITED connections - ALL at once!
        maxFreeSockets: Infinity,
        scheduling: 'fifo'
      })
    });

    // Use MAXIMUM highWaterMark for 5G speed streaming
    const writer = fs.createWriteStream(videoFile, {
      highWaterMark: 1024 * 1024 * 256 // 256MB buffer (was 64MB) - 5G speed!
    });
    
    // Optimized streaming with backpressure handling
    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
      writer.on('finish', async () => {
        // Get file info using ffprobe
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
            title: path.basename(urlPath, ext) || 'Video',
            duration: Math.round(duration),
            uploader: 'Unknown',
            uploadDate: '',
            description: '',
            thumbnail: '',
            webpageUrl: url,
            platform: 'direct'
          });
        } catch (error) {
          // If ffprobe fails, still return basic info
          resolve({
            videoFile,
            title: path.basename(urlPath, ext) || 'Video',
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
    // Check if yt-dlp is available
    try {
      await execAsyncSpawn('which', ['yt-dlp']);
    } catch {
      throw new Error('yt-dlp is not installed. Please install it: brew install yt-dlp or pip3 install yt-dlp');
    }
    
    // Check if aria2c is available (for maximum speed) - if not, yt-dlp will fallback automatically
    let hasAria2c = false;
    try {
      await execAsyncSpawn('which', ['aria2c']);
      hasAria2c = true;
      console.log('✅ aria2c found - using MAXIMUM speed download (64 parallel connections + 128 fragments = BLAZING FAST!)');
    } catch {
      console.warn('⚠️  aria2c not found - will use yt-dlp built-in downloader (still fast with 128 fragments)');
      console.warn('   Install aria2c for even faster downloads: brew install aria2');
    }

    // First, get video info
    const { stdout: infoJson } = await execAsyncSpawn('yt-dlp', [
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
      '--prefer-ffmpeg', // Use ffmpeg for faster processing
      '--postprocessor-args', 'ffmpeg:-threads 0 -preset ultrafast', // Use all CPU cores
      '--extractor-args', 'youtube:player_client=android', // Use faster extractor
      // Use aria2c for MAXIMUM speed - 32 parallel connections = 100% network usage!
      // If aria2c not available, yt-dlp will automatically fallback to built-in downloader
      ...(hasAria2c ? [
        '--external-downloader', 'aria2c',
        '--external-downloader-args', 'aria2c:-x 64 -s 64 -j 64 -k 5M --max-connection-per-server=64 --min-split-size=1M --split=64'
        // -x 64: 64 parallel connections per server (MAXIMUM!)
        // -s 64: Split into 64 pieces
        // -j 64: 64 concurrent downloads
        // -k 5M: 5MB chunk size (HUGE = MAXIMUM speed!)
        // --max-connection-per-server=64: 64 connections per server
        // --min-split-size=1M: Minimum 1MB per split
        // --split=64: Split into 64 segments
      ] : []),
      '--no-part', // Don't use .part files (faster)
      '--no-mtime', // Skip mtime (faster)
      '--no-write-thumbnail', // Skip thumbnail (faster)
      '--no-write-info-json', // Skip info json (faster)
      '--no-playlist', // Skip playlists (faster)
      '--no-call-home', // Don't check for updates (faster)
      '--no-colors', // No colors in output (faster)
      '-o', outputPath,
      url
    ];

    // If progress callback provided, track download progress
    if (progressCallback) {
      await execAsyncSpawnWithProgress('yt-dlp', downloadArgs, progressCallback);
    } else {
      await execAsyncSpawn('yt-dlp', downloadArgs);
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
 * Main download function - auto-detects platform
 * @param {string} url - Video URL
 * @param {Function} progressCallback - Optional callback for download progress (0-100)
 */
export async function downloadVideo(url, progressCallback = null) {
  // Check if it's a direct video file
  if (isDirectVideoFile(url)) {
    console.log('Detected direct video file, downloading directly...');
    return await downloadDirectFile(url);
  }

  const platform = detectPlatform(url);

  // ALWAYS use yt-dlp with MAXIMUM parallelization - it's faster than YouTube-specific downloader!
  // yt-dlp with 128 fragments + aria2c (64 connections) = BLAZING FAST!
  return await downloadWithYtDlp(url, progressCallback);
}
