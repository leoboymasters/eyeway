import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Sparkles, Square } from 'lucide-react';

import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';
import {
  GEMINI_CACHE_UPDATED_EVENT,
  getGeminiBatchEntry,
  geminiRowStamp,
  isGeminiBatchCurrent,
  setGeminiBatchEntry,
} from '@/lib/geminiBatchCache';
import { resolvePreviewAndCrop } from '@/lib/potholeImages';
import { analyzeRoadImage } from '@/services/geminiRoadAnalysis';
import { useToast } from '@/hooks/use-toast';
import type { Pothole } from '@/types';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

const PAUSE_MS = 450;

function geminiConfigured(): boolean {
  const key = import.meta.env.VITE_GEMINI_API_KEY?.trim();
  const proxy = import.meta.env.VITE_GEMINI_PROXY_URL?.trim();
  return Boolean(key || proxy);
}

export interface GeminiBatchFabProps {
  potholes: Pothole[];
  railOpen: boolean;
  isMobile: boolean;
}

export function GeminiBatchFab({ potholes, railOpen, isMobile }: GeminiBatchFabProps) {
  const { toast } = useToast();
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ index: 0, total: 0, skipped: 0, analyzed: 0, noImage: 0, failed: 0 });
  const cancelRef = useRef(false);

  const rightClass = useMemo(() => {
    if (isMobile) return 'right-4';
    if (railOpen) {
      return 'right-[calc(0.75rem+min(24rem,calc(100vw-1.5rem))+0.5rem)]';
    }
    return 'right-4';
  }, [isMobile, railOpen]);

  const runBatch = useCallback(async () => {
    if (!geminiConfigured()) {
      toast({
        variant: 'destructive',
        title: 'Gemini not configured',
        description: 'Set VITE_GEMINI_API_KEY or VITE_GEMINI_PROXY_URL in .env.local.',
      });
      return;
    }
    if (running || potholes.length === 0) {
      if (potholes.length === 0) {
        toast({ title: 'No potholes', description: 'Load data first, then run batch analyze.' });
      }
      return;
    }

    cancelRef.current = false;
    setRunning(true);
    const total = potholes.length;
    setProgress({ index: 0, total, skipped: 0, analyzed: 0, noImage: 0, failed: 0 });

    let skipped = 0;
    let analyzed = 0;
    let noImage = 0;
    let failed = 0;
    let firstError: string | null = null;

    for (let i = 0; i < potholes.length; i++) {
      if (cancelRef.current) break;

      const p = potholes[i];
      setProgress({ index: i + 1, total, skipped, analyzed, noImage, failed });

      // select('*') only requests columns that exist — explicit `frame_image_url` breaks older DBs (PostgREST 400).
      const { data, error } = await supabase
        .from('potholes')
        .select('*')
        .eq('id', p.id)
        .maybeSingle();

      if (cancelRef.current) break;
      if (error || !data) {
        failed++;
        if (!firstError) {
          const msg = error?.message ?? (!data ? 'No row returned for this id' : 'Unknown Supabase error');
          firstError = `Supabase: ${msg}`;
          console.error('[Gemini batch] Supabase:', p.id.slice(0, 8), error ?? 'no data');
        }
        setProgress({ index: i + 1, total, skipped, analyzed, noImage, failed });
        continue;
      }

      const stamp = geminiRowStamp({
        updated_at: data.updated_at as string | null | undefined,
        image_url: data.image_url as string | null | undefined,
        frame_image_url:
          'frame_image_url' in data ? (data as { frame_image_url?: string | null }).frame_image_url : undefined,
      });
      if (isGeminiBatchCurrent(p.id, stamp)) {
        const entry = getGeminiBatchEntry(p.id);
        const existingDesc = (data as { description?: string | null }).description?.trim();
        if (entry && !existingDesc) {
          const desc = entry.analysis.scene_summary.trim();
          if (desc) {
            const { error: upErr } = await supabase
              .from('potholes')
              .update({ description: desc })
              .eq('id', p.id);
            if (!upErr) {
              window.dispatchEvent(new CustomEvent(GEMINI_CACHE_UPDATED_EVENT));
            }
          }
        }
        skipped++;
        setProgress({ index: i + 1, total, skipped, analyzed, noImage, failed });
        continue;
      }

      const { preview, crop } = resolvePreviewAndCrop(
        data.image_url as string | null | undefined,
        'frame_image_url' in data ? (data as { frame_image_url?: string | null }).frame_image_url : undefined,
      );
      const target = crop ?? preview;
      if (!target) {
        noImage++;
        setProgress({ index: i + 1, total, skipped, analyzed, noImage, failed });
        continue;
      }

      try {
        const analysis = await analyzeRoadImage(target);
        setGeminiBatchEntry(p.id, stamp, analysis);
        window.dispatchEvent(new CustomEvent(GEMINI_CACHE_UPDATED_EVENT));
        const desc = analysis.scene_summary.trim();
        if (desc) {
          const { error: descErr } = await supabase
            .from('potholes')
            .update({ description: desc })
            .eq('id', p.id);
          if (descErr) {
            console.warn('[Gemini batch] description update:', p.id.slice(0, 8), descErr.message);
          } else {
            window.dispatchEvent(new CustomEvent(GEMINI_CACHE_UPDATED_EVENT));
          }
        }
        analyzed++;
      } catch (e) {
        failed++;
        if (!firstError) {
          firstError = e instanceof Error ? e.message : String(e);
          console.error('[Gemini batch] analyze:', p.id.slice(0, 8), e);
        }
      }
      setProgress({ index: i + 1, total, skipped, analyzed, noImage, failed });

      if (i < potholes.length - 1 && !cancelRef.current) {
        await new Promise((r) => setTimeout(r, PAUSE_MS));
      }
    }

    setRunning(false);

    toast({
      title: cancelRef.current ? 'Gemini batch stopped' : 'Gemini batch finished',
      description: [
        `${analyzed} analyzed, ${skipped} skipped (up to date), ${noImage} no image, ${failed} failed.`,
        firstError ? `First error: ${firstError}` : null,
      ]
        .filter(Boolean)
        .join(' '),
      variant: failed > 0 && analyzed === 0 ? 'destructive' : 'default',
    });
  }, [potholes, toast]);

  const stopBatch = () => {
    cancelRef.current = true;
  };

  const configured = geminiConfigured();

  return (
    <TooltipProvider delayDuration={300}>
      <div
        className={cn(
          'fixed z-[45] flex flex-col items-end gap-2',
          isMobile ? 'bottom-20' : 'bottom-4',
          rightClass,
        )}
      >
        {running ? (
          <div className="max-w-[min(18rem,calc(100vw-2rem))] rounded-xl border border-violet-200/80 bg-white/95 px-3 py-2 text-xs shadow-lg backdrop-blur-sm">
            <div className="font-medium text-slate-900">Gemini batch</div>
            <div className="mt-1 tabular-nums text-slate-600">
              {progress.index}/{progress.total} · {progress.analyzed} new · {progress.skipped} skipped
            </div>
            {(progress.noImage > 0 || progress.failed > 0) && (
              <div className="mt-0.5 text-[10px] text-slate-500">
                {progress.noImage > 0 ? `${progress.noImage} no image` : null}
                {progress.noImage > 0 && progress.failed > 0 ? ' · ' : null}
                {progress.failed > 0 ? `${progress.failed} errors` : null}
              </div>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-2 h-8 w-full border-violet-200 text-[11px]"
              onClick={stopBatch}
            >
              <Square className="mr-1.5 h-3 w-3" strokeWidth={2} />
              Stop after current
            </Button>
          </div>
        ) : null}

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              disabled={!configured || running || potholes.length === 0}
              onClick={() => void runBatch()}
              className={cn(
                'flex h-14 w-14 items-center justify-center rounded-full shadow-lg transition focus-visible:outline focus-visible:ring-2 focus-visible:ring-violet-400 focus-visible:ring-offset-2',
                configured && potholes.length > 0 && !running
                  ? 'bg-violet-700 text-white hover:bg-violet-800'
                  : 'cursor-not-allowed bg-slate-300 text-slate-500',
              )}
              aria-label="Run Gemini on all potholes"
            >
              <Sparkles className="h-6 w-6" strokeWidth={1.75} aria-hidden />
            </button>
          </TooltipTrigger>
          <TooltipContent side="left" className="max-w-[240px] text-xs">
            {configured
              ? 'Analyze all loaded potholes with Gemini (skips rows already analyzed unless the image or record changed).'
              : 'Add VITE_GEMINI_API_KEY or VITE_GEMINI_PROXY_URL to .env.local'}
          </TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  );
}
