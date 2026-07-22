'use client'

import { useState } from 'react'
import toast from 'react-hot-toast'
import { validateEmail } from '@/lib/utils/validators'

export default function LoginForm() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const value = email.trim()
    if (!validateEmail(value)) {
      toast.error('Please enter a valid email')
      return
    }
    setLoading(true)
    try {
      const res = await fetch('/api/account/send-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: value }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Something went wrong')
      setSent(true)
      if (data.dev) {
        toast('Dev mode: open the sign-in link printed in your server terminal', {
          icon: '🔑',
          duration: 6000,
        })
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  if (sent) {
    return (
      <div className="mx-auto max-w-md rounded-2xl border border-gray-200 bg-white p-8 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-[#DCFDCC]">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="#12BC00"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-6 w-6"
          >
            <rect x="2" y="4" width="20" height="16" rx="2" />
            <path d="m22 7-10 5L2 7" />
          </svg>
        </div>
        <h1 className="font-heading text-2xl font-bold text-gray-900">Check your email</h1>
        <p className="mt-2 text-sm text-gray-500">
          We sent a sign-in link to{' '}
          <span className="font-medium text-gray-700">{email.trim()}</span>. It expires in 15 minutes.
        </p>
        <button
          onClick={() => setSent(false)}
          className="mt-5 text-sm font-medium text-gray-500 transition-colors hover:text-gray-900"
        >
          Use a different email
        </button>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-md">
      <h1 className="font-heading text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">
        Your orders
      </h1>
      <p className="mt-3 text-sm text-gray-500 sm:text-base">
        Enter the email you used at checkout and we&apos;ll send you a secure link to view your past
        orders. No password needed.
      </p>
      <form onSubmit={handleSubmit} className="mt-6 space-y-3">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          autoComplete="email"
          className="w-full rounded-xl border border-gray-300 bg-white px-4 py-3 text-sm text-gray-900 placeholder:text-gray-400 focus:border-[#12BC00] focus:outline-none focus:ring-1 focus:ring-[#12BC00]"
        />
        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-full bg-[#12BC00] px-6 py-3.5 text-sm font-semibold text-white transition-all hover:bg-[#0fa600] active:scale-[0.98] disabled:opacity-50 sm:text-base"
        >
          {loading ? 'Sending…' : 'Email me a sign-in link'}
        </button>
      </form>
    </div>
  )
}
