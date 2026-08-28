import './globals.css'
import { Providers } from './providers'
import { Toaster } from '@/components/ui/sonner'

export const metadata = {
  title: 'Robloot — The Roblox Items Marketplace',
  description: 'Discover, buy and sell Roblox limiteds, UGC, accessories and collectibles. Original marketplace demo.',
}

export default function RootLayout({ children }) {
  return (
    <html lang="en" className="dark">
      <head>
        <script dangerouslySetInnerHTML={{__html:'window.addEventListener("error",function(e){if(e.error instanceof DOMException&&e.error.name==="DataCloneError"&&e.message&&e.message.includes("PerformanceServerTiming")){e.stopImmediatePropagation();e.preventDefault()}},true);'}} />
      </head>
      <body className="bg-[#0a0912] text-slate-100 antialiased">
        <Providers>{children}</Providers>
        <Toaster position="top-center" richColors theme="dark" />
      </body>
    </html>
  )
}
