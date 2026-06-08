import type { Metadata } from 'next';
import { ClerkProvider } from '@clerk/nextjs';
import './globals.css';
import LlmConfigPanel from '@/components/llm-config-panel';
import { ThemeProvider } from '@/components/theme-provider';

export const metadata: Metadata = {
  title: 'TestPilot — AI-powered E2E Testing',
  description: 'Automatically discover, generate, and run E2E tests for any web app.',
  viewport: 'width=device-width, initial-scale=1',
  icons: {
    icon: [
      { url: '/icon.svg',     type: 'image/svg+xml' },   // modern browsers (SVG)
      { url: '/icon-32.png',  type: 'image/png', sizes: '32x32' },
      { url: '/icon-16.png',  type: 'image/png', sizes: '16x16' },
    ],
    apple: { url: '/icon-180.png', sizes: '180x180' },   // iOS home-screen icon
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider>
      <html lang="en" className="h-full antialiased">
        <head>
          {/* Anti-flash: apply stored theme class before first paint.
              Must be a plain <script> in <head> — Next.js Script with
              strategy="beforeInteractive" triggers a React warning when
              placed inside a component body. */}
          <script dangerouslySetInnerHTML={{ __html: `(function(){try{var s=localStorage.getItem('testpilot-theme');if(!s)s=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';if(s==='light')document.documentElement.classList.add('light');}catch(e){}})();` }} />
        </head>
        <body className="min-h-full bg-zinc-950 text-zinc-100 flex flex-col overflow-x-hidden">
          <ThemeProvider>
            {children}
            <LlmConfigPanel />
          </ThemeProvider>
        </body>
      </html>
    </ClerkProvider>
  );
}
