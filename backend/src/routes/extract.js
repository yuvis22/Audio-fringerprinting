import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs-extra';
import { processVideo } from '../services/videoProcessor.js';

const router = express.Router();

// Debug endpoint to check ACRCloud config (remove in production)
router.get('/debug/acrcloud', (req, res) => {
  const hasKey = !!process.env.ACRCLOUD_ACCESS_KEY;
  const hasSecret = !!process.env.ACRCLOUD_ACCESS_SECRET;
  const host = process.env.ACRCLOUD_HOST || 'identify-us-west-2.acrcloud.com';
  
  res.json({
    configured: hasKey && hasSecret,
    hasKey,
    hasSecret,
    host,
    keyLength: process.env.ACRCLOUD_ACCESS_KEY?.length || 0,
    secretLength: process.env.ACRCLOUD_ACCESS_SECRET?.length || 0
  });
});

// In-memory job storage (for MVP, use Redis in production)
const jobs = new Map();

// POST /api/extract - Start video processing
router.post('/extract', async (req, res) => {
  try {
    const { videoUrl } = req.body;

    if (!videoUrl || typeof videoUrl !== 'string') {
      return res.status(400).json({ error: 'Video URL is required' });
    }

    // Validate URL format
    try {
      new URL(videoUrl);
    } catch {
      return res.status(400).json({ error: 'Invalid URL format' });
    }

    // Create job
    const taskId = uuidv4();
    jobs.set(taskId, {
      taskId,
      status: 'processing',
      progress: 0,
      downloadProgress: 0, // Separate download progress (0-100%)
      videoUrl,
      createdAt: new Date().toISOString(),
      result: null,
      error: null
    });

    // Process video in background
    processVideo(taskId, videoUrl, jobs)
      .catch(error => {
        console.error(`Job ${taskId} failed:`, error);
        const job = jobs.get(taskId);
        if (job) {
          job.status = 'failed';
          job.error = error.message;
        }
      });

    res.json({
      taskId,
      status: 'processing',
      message: 'Video processing started'
    });
  } catch (error) {
    console.error('Error starting extraction:', error);
    res.status(500).json({ error: 'Failed to start processing' });
  }
});

// GET /api/status/:taskId - Get processing status
router.get('/status/:taskId', (req, res) => {
  try {
    const { taskId } = req.params;
    const job = jobs.get(taskId);

    if (!job) {
      return res.status(404).json({ error: 'Task not found' });
    }

    res.json({
      taskId: job.taskId,
      status: job.status,
      progress: job.progress,
      downloadProgress: job.downloadProgress || 0, // Include download progress
      createdAt: job.createdAt
    });
  } catch (error) {
    console.error('Error getting status:', error);
    res.status(500).json({ error: 'Failed to get status' });
  }
});

// GET /api/result/:taskId - Get processing results
router.get('/result/:taskId', (req, res) => {
  try {
    const { taskId } = req.params;
    const job = jobs.get(taskId);

    if (!job) {
      return res.status(404).json({ error: 'Task not found' });
    }

    if (job.status === 'processing') {
      return res.json({
        taskId: job.taskId,
        status: 'processing',
        progress: job.progress,
        message: 'Processing in progress'
      });
    }

    if (job.status === 'failed') {
      return res.status(500).json({
        taskId: job.taskId,
        status: 'failed',
        error: job.error
      });
    }

    res.json({
      taskId: job.taskId,
      status: job.status,
      result: job.result
    });
  } catch (error) {
    console.error('Error getting result:', error);
    res.status(500).json({ error: 'Failed to get result' });
  }
});

// GET /api/download/:filename - Download audio file
router.get('/download/:filename', (req, res) => {
  try {
    let { filename } = req.params;
    filename = decodeURIComponent(filename);
    
    // If filename contains path separators, extract just the filename
    const basename = path.basename(filename);
    
    // Construct file path
    let filePath;
    if (filename.includes(path.sep) || filename.includes('/') || filename.includes('\\')) {
      // Full path provided - use it directly (but validate it's in downloads dir)
      filePath = path.resolve(filename);
      const downloadsDir = path.resolve(process.env.DOWNLOAD_DIR || './downloads');
      if (!filePath.startsWith(downloadsDir)) {
        return res.status(403).json({ error: 'Access denied' });
      }
    } else {
      // Just filename - construct path
      filePath = path.join(process.env.DOWNLOAD_DIR || './downloads', basename);
    }

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found' });
    }

    const downloadName = path.basename(filePath);
    res.download(filePath, downloadName, (err) => {
      if (err) {
        console.error('Download error:', err);
        if (!res.headersSent) {
          res.status(500).json({ error: 'Download failed' });
        }
      }
    });
  } catch (error) {
    console.error('Error downloading file:', error);
    res.status(500).json({ error: 'Download failed' });
  }
});

export default router;
