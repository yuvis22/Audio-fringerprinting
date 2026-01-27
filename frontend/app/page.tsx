'use client'

import { useState } from 'react'
import VideoInput from '@/components/VideoInput'
import Results from '@/components/Results'
import Loading from '@/components/Loading'
import { API_URL } from '@/lib/config'

export default function Home() {
  const [taskId, setTaskId] = useState<string | null>(null)
  const [status, setStatus] = useState<'idle' | 'processing' | 'completed' | 'error'>('idle')
  const [result, setResult] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)

  const handleExtract = async (videoUrl: string) => {
    try {
      setStatus('processing')
      setError(null)
      setResult(null)
      
      // Start extraction
      const response = await fetch(`${API_URL}/api/extract`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ videoUrl }),
      })

      if (!response.ok) {
        throw new Error('Failed to start extraction')
      }

      const data = await response.json()
      setTaskId(data.taskId)

      // Poll for results
      pollStatus(data.taskId)
    } catch (err: any) {
      setStatus('error')
      setError(err.message || 'An error occurred')
    }
  }

  const pollStatus = async (taskId: string) => {
    const interval = setInterval(async () => {
      try {
        const statusResponse = await fetch(`${API_URL}/api/status/${taskId}`)
        const statusData = await statusResponse.json()

        if (statusData.status === 'completed') {
          clearInterval(interval)
          
          const resultResponse = await fetch(`${API_URL}/api/result/${taskId}`)
          const resultData = await resultResponse.json()
          
          setResult(resultData.result)
          setStatus('completed')
        } else if (statusData.status === 'failed') {
          clearInterval(interval)
          setStatus('error')
          setError('Processing failed')
        }
      } catch (err) {
        clearInterval(interval)
        setStatus('error')
        setError('Failed to check status')
      }
    }, 2000) // Poll every 2 seconds
  }

  const handleReset = () => {
    setTaskId(null)
    setStatus('idle')
    setResult(null)
    setError(null)
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50">
      <div className="container mx-auto px-4 py-8 max-w-6xl">
        <div className="text-center mb-8">
          <h1 className="text-4xl md:text-5xl font-bold text-gray-900 mb-4">
            🎵 Video Audio Extractor
          </h1>
          <p className="text-lg text-gray-600">
            Extract audio and identify music tracks from any video
          </p>
        </div>

        {status === 'idle' && (
          <VideoInput onExtract={handleExtract} />
        )}

        {status === 'processing' && (
          <Loading taskId={taskId} />
        )}

        {status === 'completed' && result && (
          <Results result={result} onReset={handleReset} />
        )}

        {status === 'error' && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-center">
            <p className="text-red-800 font-semibold mb-2">Error</p>
            <p className="text-red-600">{error}</p>
            <button
              onClick={handleReset}
              className="mt-4 px-6 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition"
            >
              Try Again
            </button>
          </div>
        )}
      </div>
    </main>
  )
}
