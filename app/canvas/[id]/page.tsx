'use client';

import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { FeatureCanvas } from '@/components/feature-canvas';

export default function CanvasPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params.id;

  return (
    <div className="flex flex-col h-screen bg-white">
      <header className="shrink-0 border-b border-gray-100 bg-white px-5 py-3 flex items-center gap-4 z-10">
        <button
          onClick={() => router.push(`/session/${id}`)}
          className="text-gray-400 hover:text-gray-700 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <p className="text-sm font-semibold text-gray-800 flex-1">Feature Canvas</p>
      </header>
      {/* flex-1 min-h-0 gives ReactFlow a concrete pixel height from the flex parent */}
      <div className="flex-1 min-h-0 flex flex-col">
        <FeatureCanvas sessionId={id} showToolbar />
      </div>
    </div>
  );
}
