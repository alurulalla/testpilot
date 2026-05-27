import type { Metadata } from 'next';
import './globals.css';
import LlmConfigPanel from '@/components/llm-config-panel';

export const metadata: Metadata = {
  title: 'TestPilot — AI-powered E2E Testing',
  description: 'Automatically discover, generate, and run E2E tests for any web app.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full bg-zinc-950 text-zinc-100 flex flex-col">
        {children}
        <LlmConfigPanel />
      </body>
    </html>
  );
}
