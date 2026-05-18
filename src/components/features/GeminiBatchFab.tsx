import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Sparkle, Square } from 'lucide-react';

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
        const existingAnalysis =
          'gemini_analysis' in data ? (data as { gemini_analysis?: unknown }).gemini_analysis : null;
        // Backfill the DB if the localStorage cache has a verdict but Supabase doesn't yet.
        if (entry && (!existingAnalysis || !existingDesc)) {
          const desc = entry.analysis.scene_summary.trim();
          const upd: { gemini_analysis?: unknown; description?: string } = {};
          if (!existingAnalysis) upd.gemini_analysis = entry.analysis;
          if (!existingDesc && desc) upd.description = desc;
          if (Object.keys(upd).length > 0) {
            const { error: upErr } = await supabase.from('potholes').update(upd).eq('id', p.id);
            if (!upErr) {
              window.dispatchEvent(new CustomEvent(GEMINI_CACHE_UPDATED_EVENT));
            } else if (/gemini_analysis/i.test(upErr.message ?? '') && !existingDesc && desc) {
              await supabase.from('potholes').update({ description: desc }).eq('id', p.id);
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
        // Persist the full verdict so every viewer (and the deployed dashboard) sees the same green/red markers.
        const desc = analysis.scene_summary.trim();
        const update: { gemini_analysis: unknown; description?: string } = { gemini_analysis: analysis };
        if (desc) update.description = desc;
        const { error: upErr } = await supabase.from('potholes').update(update).eq('id', p.id);
        if (upErr) {
          // `gemini_analysis` column may be missing on older DBs — fall back to description-only.
          if (/gemini_analysis/i.test(upErr.message ?? '')) {
            if (desc) {
              await supabase.from('potholes').update({ description: desc }).eq('id', p.id);
            }
            if (!firstError) firstError = `DB missing gemini_analysis column — apply latest migration.`;
          } else {
            console.warn('[Gemini batch] update:', p.id.slice(0, 8), upErr.message);
          }
        } else {
          window.dispatchEvent(new CustomEvent(GEMINI_CACHE_UPDATED_EVENT));
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
  const enabled = configured && potholes.length > 0 && !running;
  const pct = progress.total > 0 ? Math.min(100, Math.round((progress.index / progress.total) * 100)) : 0;
  const ringDegrees = pct * 3.6;

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
          <div className="w-[min(20rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-orange-200/70 bg-white/95 shadow-xl backdrop-blur-md">
            <div className="flex items-center gap-2 bg-gradient-to-r from-orange-50 to-rose-50 px-3 py-2">
              <Sparkle className="h-3.5 w-3.5 text-orange-600" strokeWidth={2} />
              <div className="text-[11px] font-semibold uppercase tracking-wide text-orange-700">
                Gemini analyzing
              </div>
              <div className="ml-auto tabular-nums text-[11px] font-medium text-orange-700">
                {pct}%
              </div>
            </div>
            <div className="px-3 pb-3 pt-2">
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-orange-100">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-orange-500 to-rose-500 transition-all duration-300 ease-out"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <div className="mt-2 flex items-baseline gap-1 text-xs text-slate-700">
                <span className="tabular-nums font-medium text-slate-900">{progress.index}</span>
                <span className="text-slate-400">/</span>
                <span className="tabular-nums text-slate-500">{progress.total}</span>
                <span className="ml-1.5 text-slate-400">·</span>
                <span className="ml-1 tabular-nums text-emerald-600">{progress.analyzed} new</span>
                {progress.skipped > 0 && (
                  <>
                    <span className="ml-1 text-slate-400">·</span>
                    <span className="ml-1 tabular-nums text-slate-500">{progress.skipped} cached</span>
                  </>
                )}
              </div>
              {(progress.noImage > 0 || progress.failed > 0) && (
                <div className="mt-1 text-[10px] text-slate-500">
                  {progress.noImage > 0 ? `${progress.noImage} no image` : null}
                  {progress.noImage > 0 && progress.failed > 0 ? ' · ' : null}
                  {progress.failed > 0 ? (
                    <span className="text-rose-600">{progress.failed} errors</span>
                  ) : null}
                </div>
              )}
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-2.5 h-8 w-full border-orange-200 bg-white text-[11px] font-medium text-orange-700 hover:bg-orange-50 hover:text-orange-800"
                onClick={stopBatch}
              >
                <Square className="mr-1.5 h-3 w-3" strokeWidth={2} />
                Stop after current
              </Button>
            </div>
          </div>
        ) : null}

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              disabled={!configured || running || potholes.length === 0}
              onClick={() => void runBatch()}
              aria-label="Run Gemini on all potholes"
              className={cn(
                'group relative flex h-12 w-12 items-center justify-center rounded-full transition-all duration-200',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400/50 focus-visible:ring-offset-2',
                enabled && 'hover:scale-[1.04] active:scale-95',
                !enabled && !running && 'cursor-not-allowed',
              )}
              style={
                running
                  ? {
                      backgroundImage: `conic-gradient(rgb(249 115 22) ${ringDegrees}deg, rgb(255 237 213) ${ringDegrees}deg)`,
                      padding: '2px',
                    }
                  : undefined
              }
            >
              <span
                className={cn(
                  'relative flex h-full w-full items-center justify-center rounded-full ring-1 transition-colors',
                  running
                    ? 'bg-white text-orange-600 ring-white'
                    : enabled
                      ? 'bg-orange-500 text-white ring-orange-500/20 shadow-sm group-hover:bg-orange-600'
                      : 'bg-slate-100 text-slate-400 ring-slate-200 shadow-none',
                )}
              >
                <Sparkle
                  className="h-5 w-5"
                  strokeWidth={1.75}
                  aria-hidden
                />
              </span>
            </button>
          </TooltipTrigger>
          <TooltipContent side="left" className="max-w-[260px] text-xs leading-relaxed">
            {!configured
              ? 'Add VITE_GEMINI_API_KEY or VITE_GEMINI_PROXY_URL to .env.local.'
              : running
                ? 'Gemini batch is running. Click the panel to stop.'
                : potholes.length === 0
                  ? 'No potholes loaded yet — load data first.'
                  : `Analyze ${potholes.length} pothole${potholes.length === 1 ? '' : 's'} with Gemini. Skips rows already up-to-date.`}
          </TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  );
}
