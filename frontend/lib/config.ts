/**
 * API configuration
 * Gets the API URL from environment variables
 * Next.js replaces NEXT_PUBLIC_* variables at build time
 */
export const API_URL: string = 
  process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5001'
