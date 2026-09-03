import './globals.css'
import { Providers } from './providers'
import { Toaster } from '@/components/ui/sonner'

export const metadata = {
  // `template` is what every nested page's own title flows into, so a route only has to
  // name itself ("Order ABC123") and still ends up branded ("Order ABC123 · Ethereal").
  // `default` covers the home page and anything that doesn't set one.
  title: {
    default: 'Ethereal — A Realm of Rare Finds',
    template: '%s · Ethereal',
  },
  description: 'Discover, buy and sell Roblox limiteds, UGC, accessories and collectibles. Original marketplace demo.',
  icons: {
    icon: '/favicon.png',
    shortcut: '/favicon.png',
    apple: '/favicon.png',
  },
}

export default function RootLayout({ children }) {
  return (
    <html lang="en" className="dark">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cinzel:wght@600;700&family=Press+Start+2P&family=VT323&display=swap" />
        <script dangerouslySetInnerHTML={{__html:'window.addEventListener("error",function(e){if(e.error instanceof DOMException&&e.error.name==="DataCloneError"&&e.message&&e.message.includes("PerformanceServerTiming")){e.stopImmediatePropagation();e.preventDefault()}},true);'}} />
      </head>
      <body className="bg-[#140a24] text-slate-100 antialiased">
        <Providers>{children}</Providers>
        <Toaster position="top-center" richColors theme="dark" />
      </body>
    </html>
  )
}
