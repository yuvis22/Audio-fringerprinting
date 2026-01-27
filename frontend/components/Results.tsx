'use client'

import { CheckCircle2, Music, Clock, User, Download, RotateCcw, ExternalLink } from 'lucide-react'
import Image from 'next/image'
import { API_URL } from '@/lib/config'

interface ResultsProps {
  result: any
  onReset: () => void
}

export default function Results({ result, onReset }: ResultsProps) {
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  const downloadAudio = () => {
    const audioPath = result.audioMetadata.audioFile || ''
    // Pass the full path, backend will extract filename securely
    const pathParam = encodeURIComponent(audioPath)
    window.open(`${API_URL}/api/download/${pathParam}`, '_blank')
  }

  return (
    <div className="space-y-6">
      {/* Video Info Card */}
      <div className="bg-white rounded-2xl shadow-xl p-6">
        <div className="flex flex-col md:flex-row gap-6">
          {result.videoInfo.thumbnail && (
            <div className="relative w-full md:w-64 h-48 rounded-lg overflow-hidden flex-shrink-0">
              <Image
                src={result.videoInfo.thumbnail}
                alt={result.videoInfo.title}
                fill
                className="object-cover"
              />
            </div>
          )}
          <div className="flex-1">
            <h2 className="text-2xl font-bold text-gray-900 mb-2">
              {result.videoInfo.title}
            </h2>
            <div className="space-y-2 text-sm text-gray-600">
              <div className="flex items-center gap-2">
                <User className="w-4 h-4" />
                <span>{result.videoInfo.uploader}</span>
              </div>
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4" />
                <span>{formatTime(result.videoInfo.duration)}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="px-2 py-1 bg-primary-100 text-primary-700 rounded text-xs font-medium">
                  {result.videoInfo.platform}
                </span>
              </div>
            </div>
            {result.videoInfo.webpageUrl && (
              <a
                href={result.videoInfo.webpageUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 mt-4 text-primary-600 hover:text-primary-700 text-sm"
              >
                <ExternalLink className="w-4 h-4" />
                View Original Video
              </a>
            )}
          </div>
        </div>
      </div>

      {/* Identified Tracks */}
      {result.identifiedTracks && result.identifiedTracks.length > 0 ? (
        <div className="bg-white rounded-2xl shadow-xl p-6">
          <div className="flex items-center gap-2 mb-6">
            <Music className="w-6 h-6 text-primary-600" />
            <h3 className="text-2xl font-bold text-gray-900">
              Identified Tracks ({result.identifiedTracks.length})
            </h3>
          </div>
          <div className="space-y-4">
            {result.identifiedTracks.map((track: any, index: number) => (
              <div
                key={index}
                className="border border-gray-200 rounded-lg p-4 hover:border-primary-300 transition"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <h4 className="text-lg font-semibold text-gray-900">
                      {track.title}
                    </h4>
                    <p className="text-gray-600 mt-1">{track.artist}</p>
                    {track.album && (
                      <p className="text-sm text-gray-500 mt-1">Album: {track.album}</p>
                    )}
                    <div className="flex items-center gap-4 mt-3 text-sm text-gray-500">
                      {track.timestamp && (
                        <span>
                          ⏱️ {formatTime(track.timestamp.start)} - {formatTime(track.timestamp.end)}
                        </span>
                      )}
                      <span className="flex items-center gap-1">
                        <CheckCircle2 className="w-4 h-4 text-green-500" />
                        {track.confidence}% match
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6 text-center">
          <p className="text-yellow-800">No music tracks identified in this video.</p>
        </div>
      )}

      {/* Audio Metadata */}
      <div className="bg-white rounded-2xl shadow-xl p-6">
        <h3 className="text-xl font-bold text-gray-900 mb-4">Audio Information</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div>
            <p className="text-gray-500">Format</p>
            <p className="font-semibold text-gray-900">{result.audioMetadata.format}</p>
          </div>
          <div>
            <p className="text-gray-500">Bitrate</p>
            <p className="font-semibold text-gray-900">
              {result.audioMetadata.bitrate ? `${Math.round(result.audioMetadata.bitrate / 1000)} kbps` : 'N/A'}
            </p>
          </div>
          <div>
            <p className="text-gray-500">Duration</p>
            <p className="font-semibold text-gray-900">
              {result.audioMetadata.duration ? formatTime(result.audioMetadata.duration) : 'N/A'}
            </p>
          </div>
          <div>
            <p className="text-gray-500">File Size</p>
            <p className="font-semibold text-gray-900">
              {result.audioMetadata.fileSizeMB || 'N/A'} MB
            </p>
          </div>
        </div>
      </div>

      {/* Processing Info */}
      {result.processingInfo && (
        <div className="bg-gray-50 rounded-lg p-4 text-sm text-gray-600">
          <p>
            Processed in {result.processingInfo.processingTime}s • 
            Analyzed {result.processingInfo.segmentsAnalyzed} segments • 
            Found {result.processingInfo.tracksFound} tracks
          </p>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-4 justify-center">
        <button
          onClick={downloadAudio}
          className="flex items-center gap-2 px-6 py-3 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition font-semibold"
        >
          <Download className="w-5 h-5" />
          Download Audio
        </button>
        <button
          onClick={onReset}
          className="flex items-center gap-2 px-6 py-3 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition font-semibold"
        >
          <RotateCcw className="w-5 h-5" />
          Extract Another Video
        </button>
      </div>
    </div>
  )
}
