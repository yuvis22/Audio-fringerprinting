import axios from 'axios';
import FormData from 'form-data';
import fs from 'fs-extra';
import path from 'path';
import crypto from 'crypto';

// Get credentials at runtime to ensure .env is loaded
function getACRCloudConfig() {
  return {
    host: process.env.ACRCLOUD_HOST || 'identify-us-west-2.acrcloud.com',
    accessKey: process.env.ACRCLOUD_ACCESS_KEY,
    accessSecret: process.env.ACRCLOUD_ACCESS_SECRET
  };
}

const PARALLEL_SEGMENTS = parseInt(process.env.PARALLEL_SEGMENTS) || 10;
const SEGMENT_DURATION = parseInt(process.env.SEGMENT_DURATION) || 60;
// Process MAXIMUM segments in parallel for fastest identification
const MAX_CONCURRENT_IDENTIFICATIONS = parseInt(process.env.MAX_CONCURRENT_IDENTIFICATIONS) || 50; // Increased from 20 to 50!

/**
 * Generate ACRCloud signature
 */
function generateSignature(accessKey, accessSecret, httpMethod, uri, dataType, signatureVersion, timestamp) {
  const stringToSign = `${httpMethod}\n${uri}\n${accessKey}\n${dataType}\n${signatureVersion}\n${timestamp}`;
  const signature = crypto
    .createHmac('sha1', accessSecret)
    .update(stringToSign)
    .digest('base64');
  return signature;
}

/**
 * Identify music from audio file using ACRCloud
 */
async function identifyWithACRCloud(audioFile, segmentIndex) {
  const config = getACRCloudConfig();
  
  if (!config.accessKey || !config.accessSecret) {
    console.warn(`ACRCloud credentials not configured - skipping segment ${segmentIndex}`);
    return null; // Return null instead of throwing - allows processing to continue
  }

  // Check if file exists and is readable
  try {
    if (!(await fs.pathExists(audioFile))) {
      console.error(`Segment file not found: ${audioFile}`);
      return null;
    }
    
    const fileStats = await fs.stat(audioFile);
    if (fileStats.size === 0) {
      console.error(`Segment file is empty: ${audioFile}`);
      return null;
    }
    
    // Check file size limit (ACRCloud has limits - typically 1MB for free tier)
    // Using 1MB to be safe, but can be increased for paid tiers
    const maxFileSize = 1 * 1024 * 1024; // 1MB limit
    if (fileStats.size > maxFileSize) {
      console.warn(`Segment file too large (${Math.round(fileStats.size / 1024)}KB, max 1MB): ${audioFile}`);
      return null;
    }
    
    // Check minimum file size (ACRCloud needs at least some audio data)
    if (fileStats.size < 1000) { // Less than 1KB is probably invalid
      console.warn(`Segment file too small (${fileStats.size} bytes): ${audioFile}`);
      return null;
    }
  } catch (fileError) {
    console.error(`Error checking segment file ${audioFile}:`, fileError.message);
    return null;
  }

  try {
    const timestamp = Math.floor(Date.now() / 1000);
    const httpMethod = 'POST';
    const uri = '/v1/identify';
    const dataType = 'audio';
    const signatureVersion = '1';
    
    const signature = generateSignature(
      config.accessKey,
      config.accessSecret,
      httpMethod,
      uri,
      dataType,
      signatureVersion,
      timestamp
    );

    const fileStats = await fs.stat(audioFile);
    const formData = new FormData();
    
    // Use absolute path to avoid issues with special characters
    const absolutePath = path.isAbsolute(audioFile) ? audioFile : path.resolve(audioFile);
    const filename = path.basename(absolutePath);
    
    // Append file with proper options for ACRCloud
    formData.append('sample', fs.createReadStream(absolutePath), {
      filename: filename,
      contentType: 'audio/mpeg' // MP3 MIME type
    });
    formData.append('access_key', config.accessKey);
    formData.append('data_type', dataType);
    formData.append('signature_version', signatureVersion);
    formData.append('signature', signature);
    formData.append('sample_bytes', fileStats.size.toString());
    formData.append('timestamp', timestamp.toString());

    const response = await axios.post(
      `https://${config.host}${uri}`,
      formData,
      {
        headers: formData.getHeaders(),
        timeout: 10000, // Reduced timeout to 10s for faster failure (was 15s)
        maxContentLength: Infinity,
        maxBodyLength: Infinity
      }
    );

    // Log response for debugging
    if (!response.data || !response.data.status) {
      console.warn(`ACRCloud invalid response for segment ${segmentIndex}:`, response.data);
      return null;
    }

    if (response.data.status.code !== 0) {
      console.log(`ACRCloud response for segment ${segmentIndex}:`, {
        code: response.data.status.code,
        msg: response.data.status.msg || response.data.status.message
      });
      
      // Handle specific error codes
      if (response.data.status.code === 3001) {
        console.warn(`No result found for segment ${segmentIndex} (code 3001)`);
      } else if (response.data.status.code === 3003) {
        console.warn(`ACRCloud service error for segment ${segmentIndex} (code 3003)`);
      } else if (response.data.status.code === 2001) {
        console.error(`ACRCloud authentication failed (code 2001) - check credentials`);
      }
      return null;
    }

    if (response.data.status.code === 0 && response.data.metadata?.music?.length > 0) {
      const track = response.data.metadata.music[0];
      console.log(`✅ Identified track in segment ${segmentIndex}: ${track.title} by ${track.artists?.[0]?.name}`);
      return {
        title: track.title || 'Unknown',
        artist: track.artists?.[0]?.name || 'Unknown Artist',
        album: track.album?.name || null,
        genre: track.genres?.[0]?.name || null,
        releaseDate: track.release_date || null,
        duration: track.duration_ms ? Math.round(track.duration_ms / 1000) : null,
        timestamp: {
          start: segmentIndex * SEGMENT_DURATION,
          end: (segmentIndex + 1) * SEGMENT_DURATION
        },
        confidence: Math.round(track.score * 100) || 0,
        acrcloudId: track.acrid || null,
        externalIds: {
          spotify: track.external_ids?.spotify || null,
          isrc: track.external_ids?.isrc || null
        }
      };
    }

    return null;
  } catch (error) {
    // Better error logging
    if (error.response) {
      console.error(`ACRCloud API error for segment ${segmentIndex}:`, {
        status: error.response.status,
        data: error.response.data
      });
    } else if (error.request) {
      console.error(`ACRCloud request failed for segment ${segmentIndex}:`, error.message);
    } else {
      console.error(`ACRCloud error for segment ${segmentIndex}:`, error.message);
    }
    return null;
  }
}

/**
 * Identify music tracks from audio segments
 * Process ALL segments in parallel for maximum speed (no chunking delay!)
 */
export async function identifyMusicTracks(segmentFiles, job) {
  const totalSegments = segmentFiles.length;

  // Check if credentials are configured (get at runtime)
  const config = getACRCloudConfig();
  if (!config.accessKey || !config.accessSecret) {
    console.warn('⚠️  ACRCloud credentials not configured. Music identification will be skipped.');
    console.warn('   Please add ACRCLOUD_ACCESS_KEY and ACRCLOUD_ACCESS_SECRET to your .env file');
    console.warn(`   Current values: KEY=${config.accessKey ? 'SET' : 'MISSING'}, SECRET=${config.accessSecret ? 'SET' : 'MISSING'}`);
    return []; // Return empty array - processing continues without music identification
  }
  
  console.log(`✅ Using ACRCloud host: ${config.host}`);

  console.log(`Identifying music from ${totalSegments} segments (processing ALL in parallel)...`);

  // Process ALL segments in parallel at once (up to reasonable limit)
  // This eliminates the sequential chunking bottleneck
  const maxConcurrent = Math.min(MAX_CONCURRENT_IDENTIFICATIONS, totalSegments); // Process more in parallel
  
  // Process all segments in parallel batches
  const allResults = [];
  for (let i = 0; i < segmentFiles.length; i += maxConcurrent) {
    const batch = segmentFiles.slice(i, i + maxConcurrent);
    
    // Process entire batch in parallel
    const batchResults = await Promise.all(
      batch.map((segment, batchIndex) => 
        identifyWithACRCloud(segment, i + batchIndex)
      )
    );
    
    allResults.push(...batchResults.filter(Boolean));

    // Update progress
    if (job) {
      const progress = 70 + Math.round(((i + batch.length) / totalSegments) * 20);
      job.progress = Math.min(progress, 90);
    }

    console.log(`Processed ${Math.min(i + maxConcurrent, totalSegments)}/${totalSegments} segments (${allResults.length} tracks found)`);
    
    // Minimal delay between batches (reduced from 100ms to 50ms for faster processing)
    if (i + maxConcurrent < segmentFiles.length) {
      await new Promise(resolve => setTimeout(resolve, 50)); // 50ms delay (was 100ms)
    }
  }

  const identifiedTracks = allResults;

  // Remove duplicates (same track appearing in multiple segments)
  const uniqueTracks = [];
  const seenTracks = new Set();

  for (const track of identifiedTracks) {
    const trackKey = `${track.title}-${track.artist}`.toLowerCase();
    if (!seenTracks.has(trackKey)) {
      seenTracks.add(trackKey);
      uniqueTracks.push(track);
    } else {
      // Merge timestamps if same track
      const existing = uniqueTracks.find(
        t => `${t.title}-${t.artist}`.toLowerCase() === trackKey
      );
      if (existing && existing.timestamp) {
        existing.timestamp.end = Math.max(existing.timestamp.end, track.timestamp.end);
      }
    }
  }

  console.log(`Identified ${uniqueTracks.length} unique tracks`);
  return uniqueTracks;
}
