'use client'

import { useEffect } from 'react'
import { usePathname } from 'next/navigation'
import posthog from 'posthog-js'
import { PostHogProvider as PHProvider } from 'posthog-js/react'

const SENSITIVE_PATHS = ['/checkout', '/order-confirmation', '/account']
let initialized = false

function isSensitivePath(pathname: string) {
  return SENSITIVE_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`)
  )
}

function initializePostHog(key: string) {
  if (initialized) return
  posthog.init(key, {
    api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com',
    person_profiles: 'identified_only',
    capture_pageview: false,
    capture_pageleave: false,
    autocapture: false,
    disable_session_recording: true,
  })
  initialized = true
}

function SafePageView({ apiKey }: { apiKey: string }) {
  const pathname = usePathname()

  useEffect(() => {
    if (isSensitivePath(pathname)) return
    initializePostHog(apiKey)
    posthog.capture('$pageview', {
      $current_url: `${window.location.origin}${pathname}`,
    })
  }, [apiKey, pathname])

  return null
}

export default function PostHogProvider({ children }: { children: React.ReactNode }) {
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY

  if (!key) {
    return <>{children}</>
  }

  return (
    <PHProvider client={posthog}>
      <SafePageView apiKey={key} />
      {children}
    </PHProvider>
  )
}
