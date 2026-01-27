'use client'

import { useState } from 'react'
import { Search } from 'lucide-react'

interface VideoInputProps {
  onExtract: (url: string) => void
}

export default function VideoInput({ onExtract }: VideoInputProps) {
  const [url, setUrl] = useState('')
  const [isValid, setIsValid] = useState(true)

  const validateUrl = (url: string) => {
    try {
      new URL(url)
      return true
    } catch {
      return false
    }
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!url.trim()) {
      setIsValid(false)
      return
    }

    if (!validateUrl(url)) {
      setIsValid(false)
      return
    }

    setIsValid(true)
    onExtract(url.trim())
  }

  return (
    <div className="bg-white rounded-2xl shadow-xl p-8 max-w-2xl mx-auto">
      <form onSubmit={handleSubmit} className="space-y-6">
        <div>
          <label htmlFor="videoUrl" className="block text-sm font-medium text-gray-700 mb-2">
            Video URL
          </label>
          <div className="relative">
            <input
              type="text"
              id="videoUrl"
              value={url}
              onChange={(e) => {
                setUrl(e.target.value)
                setIsValid(true)
              }}
              placeholder="https://youtube.com/watch?v=... or any video platform"
              className={`w-full px-4 py-3 pl-12 border-2 rounded-lg focus:outline-none focus:ring-2 transition ${
                isValid
                  ? 'border-gray-300 focus:border-primary-500 focus:ring-primary-200'
                  : 'border-red-300 focus:border-red-500 focus:ring-red-200'
              }`}
            />
            <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
          </div>
          {!isValid && (
            <p className="mt-2 text-sm text-red-600">Please enter a valid URL</p>
          )}
          <p className="mt-2 text-sm text-gray-500">
            Supports YouTube, Vimeo, TikTok, Instagram, and more
          </p>
        </div>

        <button
          type="submit"
          className="w-full bg-gradient-to-r from-primary-600 to-purple-600 text-white py-3 px-6 rounded-lg font-semibold hover:from-primary-700 hover:to-purple-700 transition transform hover:scale-105 shadow-lg"
        >
          Extract Audio & Identify Music
        </button>
      </form>
    </div>
  )
}
