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

// Allow multiple origins (comma-separated in env)
// Allow multiple origins (comma-separated in env) + specific production domains
const envOrigins = (process.env.FRONTEND_URL || '').split(',').map(url => url.trim()).filter(Boolean);
const allowedOrigins = [
  ...envOrigins,
  'https://audio-fringerprinting.vercel.app',
  'https://audio.filmash.com',
  'https://audiofilmashfrontend.vercel.app', 
  'http://localhost:3000'
];

// Middleware
app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.indexOf(origin) !== -1 || process.env.NODE_ENV === 'development') {
      callback(null, true);
    } else {
      console.warn(`Blocked by CORS: ${origin}`);
      callback(new Error('Not allowed by CORS'));
    }
  },
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
