'use client'

import { useState } from 'react'
import type { ReactNode } from 'react'
import { validateEmail, validatePhone, validatePincode } from '@/lib/utils/validators'
import { INDIAN_STATES } from '@/lib/utils/constants'
import { Loader2, Lock, Package } from 'lucide-react'

export interface CheckoutFormData {
  name: string
  email: string
  phone: string
  whatsappOptIn: boolean
  addressLine1: string
  addressLine2: string
  city: string
  state: string
  pincode: string
}

interface CheckoutFormProps {
  onSubmit: (data: CheckoutFormData) => void
  isLoading: boolean
  paymentMethod: 'prepaid' | 'cod'
  onPaymentMethodChange: (method: 'prepaid' | 'cod') => void
  codFee: number // in paise; ₹20 = 2000
  verificationSlot?: ReactNode
}

type FormErrors = Partial<Record<keyof CheckoutFormData, string>>

export default function CheckoutForm({
  onSubmit,
  isLoading,
  paymentMethod,
  onPaymentMethodChange,
  codFee,
  verificationSlot,
}: CheckoutFormProps) {
  const [form, setForm] = useState<CheckoutFormData>({
    name: '',
    email: '',
    phone: '',
    whatsappOptIn: false,
    addressLine1: '',
    addressLine2: '',
    city: '',
    state: '',
    pincode: '',
  })
  const [errors, setErrors] = useState<FormErrors>({})

  function validate(): FormErrors {
    const errs: FormErrors = {}
    if (!form.name.trim()) errs.name = 'Name is required'
    if (!form.email.trim()) errs.email = 'Email is required'
    else if (!validateEmail(form.email.trim())) errs.email = 'Enter a valid email'
    if (!form.phone.trim()) errs.phone = 'Phone number is required'
    else if (!validatePhone(form.phone.trim())) errs.phone = 'Enter a valid 10-digit phone number'
    if (!form.addressLine1.trim()) errs.addressLine1 = 'Address is required'
    if (!form.city.trim()) errs.city = 'City is required'
    if (!form.state) errs.state = 'State is required'
    if (!form.pincode.trim()) errs.pincode = 'Pincode is required'
    else if (!validatePincode(form.pincode.trim())) errs.pincode = 'Enter a valid 6-digit pincode'
    return errs
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const errs = validate()
    setErrors(errs)
    if (Object.keys(errs).length === 0) {
      onSubmit(form)
    }
  }

  function handleChange(
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>
  ) {
    const { name, value, type } = e.target
    const checked = (e.target as HTMLInputElement).checked
    setForm((prev) => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value,
    }))
    if (errors[name as keyof CheckoutFormData]) {
      setErrors((prev) => ({ ...prev, [name]: undefined }))
    }
  }

  const inputClass =
    'w-full border-0 border-b-2 border-gray-300 bg-transparent px-0 py-3 text-sm text-gray-900 placeholder-gray-400 outline-none transition-colors focus:border-[#12BC00] focus:ring-0'

  return (
    <form onSubmit={handleSubmit} className="space-y-5" noValidate>
      <h2 className="text-lg font-bold text-gray-900 mb-3">Customer Details</h2>

      {/* Name */}
      <div>
        <input
          type="text"
          name="name"
          value={form.name}
          onChange={handleChange}
          placeholder="Full Name *"
          className={inputClass}
        />
        {errors.name && <p className="mt-1 text-xs text-red-500">{errors.name}</p>}
      </div>

      {/* Email */}
      <div>
        <input
          type="email"
          name="email"
          value={form.email}
          onChange={handleChange}
          placeholder="Email Address *"
          className={inputClass}
        />
        {errors.email && <p className="mt-1 text-xs text-red-500">{errors.email}</p>}
      </div>

      {/* Phone */}
      <div>
        <input
          type="tel"
          name="phone"
          value={form.phone}
          onChange={handleChange}
          placeholder="Phone Number (10 digits) *"
          maxLength={10}
          className={inputClass}
        />
        {errors.phone && <p className="mt-1 text-xs text-red-500">{errors.phone}</p>}
      </div>

      {/* WhatsApp opt-in */}
      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          name="whatsappOptIn"
          checked={form.whatsappOptIn}
          onChange={handleChange}
          className="h-4 w-4 rounded border-gray-300 text-brand-green accent-brand-green"
        />
        <span className="text-sm text-gray-600">Send order updates on WhatsApp</span>
      </label>

      <div className="pt-4">
        <h2 className="text-lg font-bold text-gray-900 mb-3">Shipping Address</h2>
      </div>

      {/* Address Line 1 */}
      <div>
        <input
          type="text"
          name="addressLine1"
          value={form.addressLine1}
          onChange={handleChange}
          placeholder="Address Line 1 *"
          className={inputClass}
        />
        {errors.addressLine1 && <p className="mt-1 text-xs text-red-500">{errors.addressLine1}</p>}
      </div>

      {/* Address Line 2 */}
      <div>
        <input
          type="text"
          name="addressLine2"
          value={form.addressLine2}
          onChange={handleChange}
          placeholder="Address Line 2 (optional)"
          className={inputClass}
        />
      </div>

      {/* City + Pincode row */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <input
            type="text"
            name="city"
            value={form.city}
            onChange={handleChange}
            placeholder="City *"
            className={inputClass}
          />
          {errors.city && <p className="mt-1 text-xs text-red-500">{errors.city}</p>}
        </div>
        <div>
          <input
            type="text"
            name="pincode"
            value={form.pincode}
            onChange={handleChange}
            placeholder="Pincode *"
            maxLength={6}
            className={inputClass}
          />
          {errors.pincode && <p className="mt-1 text-xs text-red-500">{errors.pincode}</p>}
        </div>
      </div>

      {/* State dropdown */}
      <div>
        <select
          name="state"
          value={form.state}
          onChange={handleChange}
          className={`${inputClass} ${!form.state ? 'text-gray-400' : ''} cursor-pointer`}
        >
          <option value="" disabled>Select State *</option>
          {INDIAN_STATES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        {errors.state && <p className="mt-1 text-xs text-red-500">{errors.state}</p>}
      </div>

      {/* Payment Method */}
      <div className="pt-4">
        <h2 className="text-lg font-bold text-gray-900 mb-3">Payment Method</h2>
      </div>

      <div className="space-y-3">
        {/* Prepaid */}
        <button
          type="button"
          onClick={() => onPaymentMethodChange('prepaid')}
          aria-pressed={paymentMethod === 'prepaid'}
          className={`flex w-full items-center justify-between gap-3 rounded-xl border px-4 py-3 text-left transition-colors ${
            paymentMethod === 'prepaid'
              ? 'border-[#12BC00] ring-1 ring-[#12BC00] bg-[#DCFDCC]/30'
              : 'border-gray-300 hover:border-gray-400'
          }`}
        >
          <span className="flex items-center gap-3">
            <span
              className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                paymentMethod === 'prepaid' ? 'border-[#12BC00]' : 'border-gray-300'
              }`}
            >
              {paymentMethod === 'prepaid' && (
                <span className="h-2.5 w-2.5 rounded-full bg-[#12BC00]" />
              )}
            </span>
            <span>
              <span className="block text-sm font-semibold text-gray-900">Pay Online</span>
              <span className="block text-xs text-gray-500">UPI · Cards · Net Banking via Razorpay</span>
            </span>
          </span>
        </button>

        {/* Cash on Delivery */}
        <button
          type="button"
          onClick={() => onPaymentMethodChange('cod')}
          aria-pressed={paymentMethod === 'cod'}
          className={`flex w-full items-center justify-between gap-3 rounded-xl border px-4 py-3 text-left transition-colors ${
            paymentMethod === 'cod'
              ? 'border-[#12BC00] ring-1 ring-[#12BC00] bg-[#DCFDCC]/30'
              : 'border-gray-300 hover:border-gray-400'
          }`}
        >
          <span className="flex items-center gap-3">
            <span
              className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                paymentMethod === 'cod' ? 'border-[#12BC00]' : 'border-gray-300'
              }`}
            >
              {paymentMethod === 'cod' && (
                <span className="h-2.5 w-2.5 rounded-full bg-[#12BC00]" />
              )}
            </span>
            <span>
              <span className="block text-sm font-semibold text-gray-900">Cash on Delivery</span>
              <span className="block text-xs text-gray-500">Pay when your order arrives</span>
            </span>
          </span>
          <span className="shrink-0 rounded-full bg-[#DCFDCC] px-2.5 py-1 text-xs font-semibold text-[#12BC00]">
            +₹{Math.round(codFee / 100)}
          </span>
        </button>
      </div>

      {verificationSlot}

      <button
        type="submit"
        disabled={isLoading}
        className="mt-6 w-full rounded-full bg-black px-6 py-3.5 text-sm font-semibold text-white transition-colors hover:bg-gray-900 active:bg-gray-800 disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
      >
        {isLoading ? (
          <>
            <Loader2 size={18} className="animate-spin" />
            Processing...
          </>
        ) : paymentMethod === 'cod' ? (
          <>
            <Package size={15} />
            Place Order · Cash on Delivery
          </>
        ) : (
          <>
            <Lock size={15} />
            Pay with Razorpay
          </>
        )}
      </button>
      <p className="mt-3 flex items-center justify-center gap-1.5 text-xs text-gray-400">
        <Lock size={12} />
        {paymentMethod === 'cod'
          ? 'Pay in cash when your order is delivered.'
          : 'Secure checkout powered by Razorpay'}
      </p>
    </form>
  )
}
