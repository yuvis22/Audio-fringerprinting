# Video Audio Extractor & Music Identifier

A full-stack application to extract audio from videos and identify music tracks using AI-powered recognition.

## 🎯 Features

- **Multi-platform Support**: Works with YouTube, Vimeo, TikTok, Instagram, and more
- **Fast Processing**: Parallel segment analysis for quick results
- **Music Identification**: Uses ACRCloud API to identify tracks
- **Rich Metadata**: Extracts comprehensive audio information
- **Modern UI**: Beautiful, responsive frontend with real-time updates
- **Background Jobs**: Non-blocking processing with status tracking

## 🏗️ Architecture

- **Frontend**: Next.js 14 (deployed on Vercel)
- **Backend**: Node.js + Express (deployed on Railway)
- **Music Recognition**: ACRCloud API
- **Video Download**: yt-dlp (multi-platform)
- **Audio Processing**: FFmpeg

## 📁 Project Structure

```
.
├── backend/          # Node.js API server
│   ├── src/
│   │   ├── server.js
│   │   ├── routes/
│   │   ├── services/
│   │   └── utils/
│   └── package.json
│
└── frontend/         # Next.js frontend
    ├── app/
    ├── components/
    └── package.json
```

## 🚀 Quick Start

### Backend Setup

1. Navigate to backend directory:
```bash
cd backend
```

2. Install dependencies:
```bash
npm install
```

3. Install system dependencies:
```bash
# macOS
brew install ffmpeg yt-dlp

# Ubuntu/Debian
sudo apt-get install ffmpeg
pip3 install yt-dlp
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

### Frontend Setup

1. Navigate to frontend directory:
```bash
cd frontend
```

2. Install dependencies:
```bash
npm install
```

3. Set up environment variables:
```bash
cp .env.example .env.local
# Set NEXT_PUBLIC_API_URL to your backend URL
```

4. Run the development server:
```bash
npm run dev
```

## 🌐 Deployment

### Backend on Railway

1. Create a new project on [Railway](https://railway.app)
2. Connect your GitHub repository (backend folder)
3. Add environment variables:
   - `ACRCLOUD_HOST`
   - `ACRCLOUD_ACCESS_KEY`
   - `ACRCLOUD_ACCESS_SECRET`
   - `FRONTEND_URL` (your Vercel URL)
4. Railway will auto-detect and deploy

### Frontend on Vercel

1. Push code to GitHub
2. Go to [Vercel](https://vercel.com) and import repository
3. Set root directory to `frontend`
4. Add environment variable:
   - `NEXT_PUBLIC_API_URL` (your Railway backend URL)
5. Deploy!

## 🔑 API Keys

### ACRCloud Setup

1. Sign up at [ACRCloud](https://www.acrcloud.com/)
2. Create a new project
3. Get your Access Key and Access Secret
4. Add to backend `.env` file

## 📝 API Endpoints

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
  "status": "processing"
}
```

### GET /api/status/:taskId
Get processing status.

### GET /api/result/:taskId
Get processing results.

## 🛠️ Tech Stack

**Backend:**
- Node.js 18+
- Express.js
- yt-dlp
- fluent-ffmpeg
- music-metadata
- ACRCloud SDK

**Frontend:**
- Next.js 14
- TypeScript
- Tailwind CSS
- React 18

## 📄 License

MIT

## 🤝 Contributing

Contributions welcome! Please open an issue or submit a PR.
