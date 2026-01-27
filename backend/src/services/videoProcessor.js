import { downloadVideo } from './videoDownloader.js';
import { extractAudio } from './audioExtractor.js';
import { splitAudioSegments } from './audioExtractor.js';
import { extractMetadata } from './metadataExtractor.js';
import { identifyMusicTracks } from './musicIdentifier.js';
import { cleanupFiles } from '../utils/fileCleanup.js';

/**
 * Main video processing pipeline
 */
export async function processVideo(taskId, videoUrl, jobs) {
  const job = jobs.get(taskId);
  if (!job) return;

  const startTime = Date.now();
  let videoFile = null;
  let audioFile = null;
  let segmentFiles = [];

  try {
    // Update progress
    job.progress = 0;
    job.status = 'processing';
    console.log(`[${taskId}] Progress: ${job.progress}%`);

    // Step 1: Download video/audio - Sequential download (continuous stream, no fragments)
    console.log(`[${taskId}] Downloading audio as continuous stream (sequential mode)...`);
    job.progress = 0; // Start at 0%
    job.downloadProgress = 0; // Track download progress separately
    console.log(`[${taskId}] Download progress: ${job.progress}%`);
    
    // Real-time download progress callback (0-100% for download phase only)
    const downloadProgressCallback = (progress) => {
      if (progress !== undefined && !isNaN(progress) && progress >= 0) {
        job.downloadProgress = progress; // Store download progress
        job.progress = progress; // Update main progress (0-100% for download)
        console.log(`[${taskId}] 📥 Download progress: ${Math.round(progress)}%`);
      }
    };
    
    const videoInfo = await downloadVideo(videoUrl, downloadProgressCallback);
    
    // Ensure download shows 100% when complete
    if (job.downloadProgress < 100) {
      job.progress = 100;
      job.downloadProgress = 100;
    }
    console.log(`[${taskId}] ✅ Download complete: 100%`);
    
    // Download is complete (100%), now move to next phase
    // Check if we got audio directly (optimized path) or need to extract
    if (videoInfo.audioFile) {
      // Audio already downloaded directly - skip extraction!
      audioFile = videoInfo.audioFile;
      videoFile = null; // No video file needed
      console.log(`[${taskId}] Audio downloaded directly (optimized)`);
    } else {
      // Fallback: extract audio from video
      videoFile = videoInfo.videoFile;
      console.log(`[${taskId}] Extracting audio from video...`);
      audioFile = await extractAudio(videoFile);
      console.log(`[${taskId}] Audio extraction complete`);
    }

    // Step 3 & 4: Extract metadata AND split complete audio file into segments for API calls
    // The audio file is already downloaded completely - now we split it into 60-second chunks for music identification
    console.log(`[${taskId}] Complete audio file downloaded. Now splitting into 60-second segments for API calls...`);
    job.progress = 45; // Starting metadata and segmentation
    console.log(`[${taskId}] Progress: ${job.progress}%`);
    
    // Start metadata extraction immediately
    const metadataPromise = extractMetadata(audioFile);
    
    // Split the complete audio file into 60-second segments for music identification API calls
    const segmentsPromise = splitAudioSegments(audioFile);
    
    // Wait for both
    const [audioMetadata, segmentFilesResult] = await Promise.all([
      metadataPromise,
      segmentsPromise
    ]);
    segmentFiles = segmentFilesResult;
    job.progress = 60; // Metadata and segmentation complete
    console.log(`[${taskId}] Progress: ${job.progress}%`);
    console.log(`[${taskId}] Split complete audio into ${segmentFiles.length} segments (60 seconds each) for API calls`);

    // Step 5: Identify music tracks (MAXIMUM parallel processing)
    console.log(`[${taskId}] Identifying music tracks with MAXIMUM parallel processing...`);
    job.progress = 65; // Starting identification
    console.log(`[${taskId}] Progress: ${job.progress}%`);
    const identifiedTracks = await identifyMusicTracks(segmentFiles, job);
    job.progress = 95; // Identification complete
    console.log(`[${taskId}] Progress: ${job.progress}%`);

    // Step 6: Compile results
    const processingTime = Math.round((Date.now() - startTime) / 1000);
    
    const result = {
      videoInfo: {
        title: videoInfo.title,
        duration: videoInfo.duration,
        uploader: videoInfo.uploader,
        uploadDate: videoInfo.uploadDate,
        thumbnail: videoInfo.thumbnail,
        platform: videoInfo.platform,
        webpageUrl: videoInfo.webpageUrl
      },
      audioMetadata: {
        ...audioMetadata,
        audioFile: audioFile // Include path for download
      },
      identifiedTracks: identifiedTracks,
      segments: identifiedTracks.map((track, index) => ({
        segmentNumber: index + 1,
        startTime: track.timestamp?.start || 0,
        endTime: track.timestamp?.end || 0,
        identifiedTrack: track
      })),
      processingInfo: {
        processingTime,
        status: 'completed',
        tracksFound: identifiedTracks.length,
        segmentsAnalyzed: segmentFiles.length
      }
    };

    job.result = result;
    job.status = 'completed';
    job.progress = 100;
    console.log(`[${taskId}] Progress: ${job.progress}%`);

    console.log(`[${taskId}] Processing completed in ${processingTime}s`);

    // Cleanup files after a delay (to allow download)
    setTimeout(() => {
      cleanupFiles([videoFile, audioFile, ...segmentFiles]);
    }, 3600000); // 1 hour

  } catch (error) {
    console.error(`[${taskId}] Processing failed:`, error);
    job.status = 'failed';
    job.error = error.message;
    
    // Cleanup on error
    cleanupFiles([videoFile, audioFile, ...segmentFiles].filter(Boolean));
  }
}
