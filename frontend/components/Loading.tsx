'use client'

import { useEffect, useState } from 'react'
import { Loader2, Music, Download, FileAudio, type LucideIcon } from 'lucide-react'
import { API_URL } from '@/lib/config'

interface LoadingProps {
  taskId: string | null
}

interface Step {
  icon: LucideIcon
  label: string
  progress: number
}

export default function Loading({ taskId }: LoadingProps) {
  const [progress, setProgress] = useState(0)
  const [downloadProgress, setDownloadProgress] = useState(0)
  const [isDownloading, setIsDownloading] = useState(true)

  useEffect(() => {
    if (!taskId) return
    
    let interval: NodeJS.Timeout | null = null
    
    // Fetch immediately
    const fetchStatus = async () => {
      try {
        const response = await fetch(`${API_URL}/api/status/${taskId}`)
        const data = await response.json()
        const newProgress = data.progress || 0
        const newDownloadProgress = data.downloadProgress || 0
        
        setProgress(newProgress)
        setDownloadProgress(newDownloadProgress)
        
        // Check if still downloading (download progress < 100)
        setIsDownloading(newDownloadProgress < 100 && newProgress < 100)
        
        // Stop polling if completed or failed
        if (data.status === 'completed' || data.status === 'failed') {
          if (interval) clearInterval(interval)
        }
      } catch (error) {
        console.error('Error fetching status:', error)
      }
    }
    
    // Fetch immediately, then poll every 500ms for smoother updates
    fetchStatus()
    interval = setInterval(fetchStatus, 500)

    return () => {
      if (interval) clearInterval(interval)
    }
  }, [taskId])

  const steps: Step[] = [
    { icon: Download, label: 'Downloading...', progress: 40 },
    { icon: FileAudio, label: 'Processing audio...', progress: 65 },
    { icon: Music, label: 'Identifying music...', progress: 95 },
  ]

  const currentStep = steps.find(step => progress < step.progress) || steps[steps.length - 1]
  const CurrentStepIcon = currentStep.icon
  
  // Use download progress (0-100%) when downloading, otherwise use overall progress
  const displayProgress = isDownloading ? downloadProgress : progress

  return (
    <div className="bg-white rounded-2xl shadow-xl p-8 max-w-2xl mx-auto">
      <div className="text-center space-y-6">
        <div className="flex justify-center">
          <Loader2 className="w-12 h-12 text-primary-600 animate-spin" />
        </div>
        
        <div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Processing Video</h2>
          <p className="text-gray-600">This may take a few minutes...</p>
        </div>

        <div className="space-y-4">
          <div className="w-full bg-gray-200 rounded-full h-3 overflow-hidden">
            <div
              className="bg-gradient-to-r from-primary-600 to-purple-600 h-full transition-all duration-500 ease-out"
              style={{ width: `${displayProgress}%` }}
            />
          </div>
          <p className="text-sm text-gray-600">
            {isDownloading ? (
              <>Downloading: {Math.round(downloadProgress)}%</>
            ) : (
              <>{Math.round(progress)}% complete</>
            )}
          </p>
        </div>

        <div className="flex items-center justify-center space-x-2 text-sm text-gray-500">
          <CurrentStepIcon className="w-4 h-4" />
          <span>{currentStep.label}</span>
        </div>

        {taskId && (
          <p className="text-xs text-gray-400">Task ID: {taskId.substring(0, 8)}...</p>
        )}
      </div>
    </div>
  )
}
