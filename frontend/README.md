# Video Audio Extractor - Frontend

Next.js frontend for video audio extraction and music identification.

## Features

- Modern, responsive UI with Tailwind CSS
- Real-time progress tracking
- Beautiful results display
- Support for multiple video platforms
- Download extracted audio files

## Tech Stack

- **Next.js 14** - React framework with App Router
- **TypeScript** - Type safety
- **Tailwind CSS** - Styling
- **Lucide React** - Icons

## Setup

### Prerequisites

- Node.js 18+
- npm or yarn

### Local Development

1. Install dependencies:
```bash
npm install
```

2. Set up environment variables:
```bash
cp .env.example .env.local
# Edit .env.local with your backend API URL
```

3. Run the development server:
```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Environment Variables

- `NEXT_PUBLIC_API_URL` - Backend API URL (default: http://localhost:5001)

## Deployment on Vercel

1. Push your code to GitHub
2. Go to [Vercel](https://vercel.com) and import your repository
3. Add environment variable:
   - `NEXT_PUBLIC_API_URL` = Your Railway backend URL
4. Deploy!

Vercel will automatically:
- Detect Next.js
- Build and deploy
- Set up HTTPS
- Provide a custom domain

## Project Structure

```
frontend/
├── app/              # Next.js App Router
│   ├── page.tsx     # Main page
│   └── layout.tsx   # Root layout
├── components/      # React components
│   ├── VideoInput.tsx
│   ├── Loading.tsx
│   └── Results.tsx
└── lib/            # Utilities (if needed)
```

## License

MIT
