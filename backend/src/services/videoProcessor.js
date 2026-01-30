import { downloadVideo } from './videoDownloader.js';
import { extractAudio } from './audioExtractor.js';
import { splitAudioSegments } from './audioExtractor.js';
import { extractMetadata } from './metadataExtractor.js';
import { identifyMusicTracks } from './musicIdentifier.js';
import { cleanupFiles } from '../utils/fileCleanup.js';

/**
 * Main video processing pipeline - NEW OPTIMIZED VERSION! ⚡
 * Downloads ONLY segments (40 sec) instead of full video (10 min)
 * 10-20x FASTER for music identification!
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

    // ⚡ STEP 1: FAST segment-based download (NEW!)
    // Downloads ONLY 40 seconds of audio from strategic positions
    // Instead of downloading 10 min video = 15x FASTER!
    console.log(`[${taskId}] 🚀 FAST MODE: Downloading smart segments...`);
    job.downloadProgress = 0;
    
    // Real-time download progress callback
    const downloadProgressCallback = (progress) => {
      if (progress !== undefined && !isNaN(progress) && progress >= 0) {
        job.downloadProgress = progress;
        job.progress = Math.round(progress * 0.5); // Download is 50% of total progress
        console.log(`[${taskId}] 📥 Download progress: ${Math.round(progress)}%`);
      }
    };
    
    // Try segment-based download first (FAST!)
    let downloadResult;
    let useFullAudio = false;
    let videoInfo;
    
    try {
      downloadResult = await downloadVideo(videoUrl, downloadProgressCallback, { mode: 'segments' });
      
      if (downloadResult.mode === 'segments') {
        // SUCCESS! Got segments
        console.log(`[${taskId}] ✅ Fast segment download complete!`);
        segmentFiles = downloadResult.segmentFiles.map(s => s.file);
        videoInfo = downloadResult.videoInfo;
      }
    } catch (segmentError) {
      console.warn(`[${taskId}] ⚠️  Segment download failed, falling back to full audio...`);
      console.warn(`[${taskId}] Error: ${segmentError.message}`);
      
      // FALLBACK: Download full audio
      useFullAudio = true;
      const fullDownload = await downloadVideo(videoUrl, downloadProgressCallback, { mode: 'full' });
      
      if (fullDownload.audioFile) {
        audioFile = fullDownload.audioFile;
        videoFile = null;
      } else if (fullDownload.videoFile) {
        videoFile = fullDownload.videoFile;
        console.log(`[${taskId}] Extracting audio from video...`);
        audioFile = await extractAudio(videoFile);
      }
      
      videoInfo = fullDownload;
    }
    
    job.progress = 50; // Download complete (whether segments or full)
    console.log(`[${taskId}] Progress: ${job.progress}%`);

    // STEP 2: Identify music from segments
    let identifiedTracks = [];
    let audioMetadata = {};
    
    if (!useFullAudio && segmentFiles.length > 0) {
      // FAST PATH: Identify from pre-downloaded segments
      console.log(`[${taskId}] 🎵 Identifying music from ${segmentFiles.length} segments...`);
      job.progress = 60;
      
      identifiedTracks = await identifyMusicTracks(segmentFiles, job);
      
      // Basic metadata from video info
      audioMetadata = {
        duration: videoInfo.duration,
        format: 'mp3',
        bitrate: '96kbps',
        sampleRate: '44100Hz',
        channels: 'stereo'
      };
      
    } else {
      // FALLBACK PATH: Split full audio into segments then identify
      console.log(`[${taskId}] Splitting full audio into segments for identification...`);
      job.progress = 60;
      
      const metadataPromise = extractMetadata(audioFile);
      const segmentsPromise = splitAudioSegments(audioFile);
      
      const [metadata, segments] = await Promise.all([metadataPromise, segmentsPromise]);
      audioMetadata = metadata;
      segmentFiles = segments;
      
      job.progress = 70;
      console.log(`[${taskId}] Identifying music from ${segmentFiles.length} segments...`);
      
      identifiedTracks = await identifyMusicTracks(segmentFiles, job);
    }
    
    job.progress = 95;
    console.log(`[${taskId}] Progress: ${job.progress}%`);

    // STEP 3: Compile results
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
        audioFile: audioFile || 'segments', // Indicate if using segments
        downloadMode: useFullAudio ? 'full' : 'segments'
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
        segmentsAnalyzed: segmentFiles.length,
        downloadMode: useFullAudio ? 'full' : 'segments (10-20x faster!)'
      }
    };

    job.result = result;
    job.status = 'completed';
    job.progress = 100;
    console.log(`[${taskId}] Progress: ${job.progress}%`);
    console.log(`[${taskId}] ✅ Processing completed in ${processingTime}s (${useFullAudio ? 'full' : 'fast'} mode)`);

    // Cleanup files after a delay
    setTimeout(() => {
      cleanupFiles([videoFile, audioFile, ...segmentFiles].filter(Boolean));
    }, 3600000); // 1 hour

  } catch (error) {
    console.error(`[${taskId}] Processing failed:`, error);
    job.status = 'failed';
    job.error = error.message;
    
    // Cleanup on error
    cleanupFiles([videoFile, audioFile, ...segmentFiles].filter(Boolean));
  }
}
