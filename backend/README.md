# Video Audio Extractor - Backend

Node.js backend API for extracting audio and identifying music from videos.

## Features

- Download videos from multiple platforms (YouTube, Vimeo, TikTok, Instagram, etc.)
- Extract audio from video files
- Identify music tracks using ACRCloud API
- Extract comprehensive audio metadata
- Background job processing with status tracking
- Parallel segment analysis for faster processing

## Tech Stack

- **Node.js 18+**
- **Express.js** - Web framework
- **yt-dlp** - Multi-platform video downloader
- **fluent-ffmpeg** - Audio extraction
- **music-metadata** - Metadata extraction
- **ACRCloud** - Music identification

## Setup

### Prerequisites

- Node.js 18+
- FFmpeg installed
- Python 3 (for yt-dlp)
- ACRCloud API credentials

### Local Development

1. Install dependencies:
```bash
npm install
```

2. Install FFmpeg:
```bash
# macOS
brew install ffmpeg

# Ubuntu/Debian
sudo apt-get install ffmpeg

# Windows
# Download from https://ffmpeg.org/download.html
```

3. Install yt-dlp:
```bash
# macOS/Linux
pip3 install yt-dlp

# Or using brew
brew install yt-dlp
```

4. Set up environment variables:
```bash
cp .env.example .env
# Edit .env with your ACRCloud credentials
```

5. Run the server:
```bash
npm run dev
```

Server will run on `http://localhost:5001`

## API Endpoints

### POST /api/extract
Start video processing.

**Request:**
```json
{
  "videoUrl": "https://youtube.com/watch?v=..."
}
```

**Response:**
```json
{
  "taskId": "uuid",
  "status": "processing",
  "message": "Video processing started"
}
```

### GET /api/status/:taskId
Get processing status.

**Response:**
```json
{
  "taskId": "uuid",
  "status": "processing",
  "progress": 50
}
```

### GET /api/result/:taskId
Get processing results.

**Response:**
```json
{
  "taskId": "uuid",
  "status": "completed",
  "result": {
    "videoInfo": {...},
    "audioMetadata": {...},
    "identifiedTracks": [...],
    "segments": [...],
    "processingInfo": {...}
  }
}
```

## Deployment on Railway

1. Create a new project on [Railway](https://railway.app)
2. Connect your GitHub repository
3. Add environment variables in Railway dashboard:
   - `ACRCLOUD_HOST`
   - `ACRCLOUD_ACCESS_KEY`
   - `ACRCLOUD_ACCESS_SECRET`
   - `FRONTEND_URL` (your Vercel frontend URL)
   - `PORT` (Railway will set this automatically)
4. Railway will automatically detect Node.js and deploy
5. Make sure FFmpeg and Python are available (nixpacks.toml handles this)

## Environment Variables

See `.env.example` for all required variables.

## License

MIT
