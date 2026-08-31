import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Order Confirmation',
  robots: {
    index: false,
    follow: false,
    nocache: true,
  },
}

export default function OrderConfirmationLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children
}
