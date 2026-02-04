import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import extractRoutes from './routes/extract.js';
import { setupCleanup } from './utils/fileCleanup.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 5001;
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';

// Middleware
app.use(cors({
  origin: FRONTEND_URL,
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Root endpoint for Render health check
app.get('/', (req, res) => {
  res.json({ 
    status: 'online', 
    service: 'Audio Fingerprinting Backend',
    version: '1.0.0'
  });
});

// API Routes
app.use('/api', extractRoutes);

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📡 Environment: ${process.env.NODE_ENV || 'development'}`);
  
  // Check for ACRCloud credentials
  if (!process.env.ACRCLOUD_ACCESS_KEY || !process.env.ACRCLOUD_ACCESS_SECRET) {
    console.warn('⚠️  WARNING: ACRCloud credentials not configured!');
    console.warn('   Music identification will be disabled.');
    console.warn('   Add ACRCLOUD_ACCESS_KEY and ACRCLOUD_ACCESS_SECRET to your .env file');
  } else {
    console.log('✅ ACRCloud credentials configured');
  }
  
  // Setup automatic file cleanup
  setupCleanup();
});

export default app;
