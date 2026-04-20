import React from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { supabase } from '@/integrations/supabase/client';
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import { Pothole } from '@/types';
import { format } from 'date-fns';
import { MapPin, Maximize2, X } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { bboxToPixelRect, parseBboxXyxy } from '@/lib/bbox';

/**
 * Map list/detail images to preview vs crop. New publishes: full frame in image_url,
 * YOLO crop in frame_image_url. Legacy rows often had crop in image_url and full in frame_image_url.
 */
function resolvePreviewAndCrop(
  imageUrl: string | null | undefined,
  frameImageUrl: string | null | undefined,
): { preview: string | null; crop: string | null } {
  if (!imageUrl && !frameImageUrl) return { preview: null, crop: null };
  if (!frameImageUrl) return { preview: imageUrl ?? null, crop: null };
  if (!imageUrl) return { preview: frameImageUrl, crop: null };
  const ia = imageUrl.length;
  const ib = frameImageUrl.length;
  if (ib > ia * 1.5) {
    return { preview: frameImageUrl, crop: imageUrl };
  }
  return { preview: imageUrl, crop: frameImageUrl };
}

/** Unified section label — sentence case, no all-caps. */
const lbl = 'text-[11px] font-medium text-slate-500';

type DetectionOverlay = {
  bbox: [number, number, number, number];
  frameWidth: number | null;
  frameHeight: number | null;
};

function detectionFromPothole(p: Pothole): DetectionOverlay | null {
  const bbox = parseBboxXyxy(p.bboxXyxy);
  if (!bbox) return null;
  return {
    bbox,
    frameWidth: p.frameWidth ?? null,
    frameHeight: p.frameHeight ?? null,
  };
}

function parseFrameDim(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Street-view frame with YOLO bbox in image pixel space (or normalized); scales with layout via SVG. */
function ImageWithBboxOverlay({
  src,
  alt,
  detection,
  imgClassName,
}: {
  src: string;
  alt: string;
  detection: DetectionOverlay;
  imgClassName: string;
}) {
  const [size, setSize] = React.useState<{ w: number; h: number } | null>(() => {
    const fw = detection.frameWidth;
    const fh = detection.frameHeight;
    if (fw != null && fh != null && fw > 0 && fh > 0) return { w: fw, h: fh };
    return null;
  });

  React.useEffect(() => {
    const fw = detection.frameWidth;
    const fh = detection.frameHeight;
    if (fw != null && fh != null && fw > 0 && fh > 0) {
      setSize({ w: fw, h: fh });
    }
  }, [detection.frameWidth, detection.frameHeight]);

  const rect = React.useMemo(() => {
    if (!size) return null;
    return bboxToPixelRect(detection.bbox, size.w, size.h);
  }, [detection.bbox, size]);

  const strokeUser = size
    ? Math.max(2, Math.min(size.w, size.h) * 0.004)
    : 2;

  if (!size) {
    return (
      <img
        src={src}
        alt={alt}
        className={imgClassName}
        onLoad={(e) => {
          const el = e.currentTarget;
          if (el.naturalWidth > 0 && el.naturalHeight > 0) {
            setSize({ w: el.naturalWidth, h: el.naturalHeight });
          }
        }}
      />
    );
  }

  return (
    <svg
      viewBox={`0 0 ${size.w} ${size.h}`}
      className={imgClassName}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={alt}
    >
      <title>{alt}</title>
      <image href={src} width={size.w} height={size.h} preserveAspectRatio="none" />
      {rect && rect.width > 0 && rect.height > 0 ? (
        <rect
          x={rect.x}
          y={rect.y}
          width={rect.width}
          height={rect.height}
          fill="none"
          stroke="#facc15"
          strokeWidth={strokeUser}
          className="pointer-events-none"
        />
      ) : null}
    </svg>
  );
}

interface PotholeDetailsProps {
  pothole: Pothole | null;
  onClose: () => void;
  onUpdateStatus?: (id: string, status: Pothole['status']) => void;
  /** Removes the row in Supabase and closes the panel (same handler as the potholes list). */
  onDeletePothole?: (id: string) => Promise<void>;
}

export const PotholeDetails = ({
  pothole,
  onClose,
  onUpdateStatus,
  onDeletePothole,
}: PotholeDetailsProps) => {
  /** Full-frame preview + optional YOLO crop; refetch row so large data URLs are not dropped. */
  const [previewUrl, setPreviewUrl] = React.useState<string | null>(null);
  const [cropUrl, setCropUrl] = React.useState<string | null>(null);
  const [detectionFrame, setDetectionFrame] = React.useState<DetectionOverlay | null>(null);
  const [lightbox, setLightbox] = React.useState<{
    src: string;
    label: string;
    detection: DetectionOverlay | null;
  } | null>(null);
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const [deleteBusy, setDeleteBusy] = React.useState(false);

  React.useEffect(() => {
    if (!pothole?.id) {
      setPreviewUrl(null);
      setCropUrl(null);
      setDetectionFrame(null);
      return;
    }
    const r0 = resolvePreviewAndCrop(pothole.images[0], pothole.frameImageUrl);
    setPreviewUrl(r0.preview);
    setCropUrl(r0.crop);
    setDetectionFrame(detectionFromPothole(pothole));
    let cancelled = false;
    void (async () => {
      // select('*') avoids PostgREST 400 when an explicit column (e.g. lidar_data) is not present
      // on the remote DB; unknown names in select=image_url,... cause Bad Request.
      const { data, error } = await supabase
        .from('potholes')
        .select('*')
        .eq('id', pothole.id)
        .maybeSingle();

      if (cancelled) return;
      if (error || !data) return;

      const r = resolvePreviewAndCrop(data.image_url, data.frame_image_url);
      setPreviewUrl(r.preview);
      setCropUrl(r.crop);
      const bbox = parseBboxXyxy(data.bbox_xyxy);
      setDetectionFrame(
        bbox
          ? {
              bbox,
              frameWidth: parseFrameDim(data.frame_width),
              frameHeight: parseFrameDim(data.frame_height),
            }
          : null
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [pothole?.id, pothole?.images?.[0], pothole?.frameImageUrl, pothole?.bboxXyxy, pothole?.frameWidth, pothole?.frameHeight]);

  if (!pothole) return null;

  const formatDate = (dateString?: string) => {
    if (!dateString) return 'Not scheduled';
    return format(new Date(dateString), 'MMM d, yyyy • h:mm a');
  };

  const getSeverityColor = (severity: Pothole['severity']) => {
    switch (severity) {
      case 'low': return 'bg-green-500';
      case 'medium': return 'bg-yellow-500';
      case 'high': return 'bg-orange-500';
      case 'critical': return 'bg-red-500';
      default: return 'bg-gray-500';
    }
  };
  
  /** Single confidence for the hero card: prefer fusion YOLO (same scale as legacy detection_accuracy). */
  const fusionYoloPct =
    pothole.fusion?.yoloConfidence != null
      ? pothole.fusion.yoloConfidence <= 1
        ? pothole.fusion.yoloConfidence * 100
        : pothole.fusion.yoloConfidence
      : null;
  const confidencePct = fusionYoloPct ?? pothole.detectionAccuracy * 100;
  const confidenceSource =
    fusionYoloPct != null ? 'Camera-based detection' : 'Automated scoring';

  const getStatusBadge = (status: Pothole['status']) => {
    switch (status) {
      case 'reported':
        return (
          <Badge variant="outline" className="h-6 border-blue-200/80 bg-blue-50/90 px-2 text-[10px] font-medium text-blue-700">
            Reported
          </Badge>
        );
      case 'inspected':
        return (
          <Badge variant="outline" className="h-6 border-purple-200/80 bg-purple-50/90 px-2 text-[10px] font-medium text-purple-700">
            Inspected
          </Badge>
        );
      case 'scheduled':
        return (
          <Badge variant="outline" className="h-6 border-amber-200/80 bg-amber-50/90 px-2 text-[10px] font-medium text-amber-800">
            Scheduled
          </Badge>
        );
      case 'in-progress':
        return (
          <Badge variant="outline" className="h-6 border-orange-200/80 bg-orange-50/90 px-2 text-[10px] font-medium text-orange-800">
            In progress
          </Badge>
        );
      case 'completed':
        return (
          <Badge variant="outline" className="h-6 border-emerald-200/80 bg-emerald-50/90 px-2 text-[10px] font-medium text-emerald-800">
            Completed
          </Badge>
        );
      default:
        return <Badge variant="outline">Unknown</Badge>;
    }
  };

  return (
    <Card
      className={cn(
        'flex h-full min-h-0 min-w-0 w-full flex-1 flex-col overflow-hidden border-0 bg-transparent shadow-none ring-0',
        'animate-fade-in'
      )}
    >
      <div
        className="min-h-0 min-w-0 flex-1 touch-pan-y overflow-y-auto overscroll-y-contain [scrollbar-gutter:stable]"
        style={{
          WebkitOverflowScrolling: 'touch',
          paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom))',
        }}
      >
      <CardHeader className="flex-shrink-0 border-0 border-b border-slate-100/90 bg-transparent px-0 pb-3 pt-0">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <CardTitle className="text-[15px] font-semibold leading-snug tracking-tight text-slate-900">
              Pothole #{pothole.id.slice(0, 8)}
            </CardTitle>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {getStatusBadge(pothole.status)}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0 rounded-full text-slate-600 hover:bg-slate-100"
              onClick={onClose}
              aria-label="Close panel"
            >
              <X size={16} strokeWidth={1.75} />
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-2 px-0 pb-3 pt-2">
        <div className="space-y-2">
          {previewUrl ? (
            <div>
              <p className={cn('mb-1', lbl)}>Street view</p>
              <button
                type="button"
                className="group relative w-full min-w-0 overflow-hidden rounded-lg border border-slate-200/80 bg-slate-100/80 text-left outline-none ring-offset-2 transition hover:border-slate-300/90 focus-visible:ring-2 focus-visible:ring-slate-400"
                onClick={() =>
                  setLightbox({
                    src: previewUrl,
                    label: 'Street view',
                    detection: detectionFrame,
                  })
                }
                aria-label="Open street view full size"
              >
                {detectionFrame ? (
                  <ImageWithBboxOverlay
                    src={previewUrl}
                    alt="Road view"
                    detection={detectionFrame}
                    imgClassName="block h-auto max-h-52 w-full rounded-lg object-contain object-center"
                  />
                ) : (
                  <img
                    src={previewUrl}
                    alt="Road view"
                    className="block h-auto max-h-52 w-full rounded-lg object-contain object-center"
                  />
                )}
                <span
                  className="pointer-events-none absolute bottom-1.5 right-1.5 flex h-7 w-7 items-center justify-center rounded-md bg-black/45 text-white opacity-0 shadow-sm backdrop-blur-[2px] transition group-hover:opacity-100"
                  aria-hidden
                >
                  <Maximize2 className="h-3.5 w-3.5" strokeWidth={2} />
                </span>
              </button>
            </div>
          ) : null}
          {cropUrl ? (
            <div>
              <p className={cn('mb-1', lbl)}>Detail crop</p>
              <button
                type="button"
                className="group relative flex max-h-36 w-full items-center justify-center overflow-hidden rounded-lg border border-slate-200/80 bg-slate-100/80 text-left outline-none ring-offset-2 transition hover:border-slate-300/90 focus-visible:ring-2 focus-visible:ring-slate-400"
                onClick={() => setLightbox({ src: cropUrl, label: 'Detail crop', detection: null })}
                aria-label="Open detail crop full size"
              >
                <img
                  src={cropUrl}
                  alt="Close-up of the pothole"
                  className="h-full max-h-36 w-full object-cover object-center"
                />
                <span
                  className="pointer-events-none absolute bottom-1.5 right-1.5 flex h-7 w-7 items-center justify-center rounded-md bg-black/45 text-white opacity-0 shadow-sm backdrop-blur-[2px] transition group-hover:opacity-100"
                  aria-hidden
                >
                  <Maximize2 className="h-3.5 w-3.5" strokeWidth={2} />
                </span>
              </button>
            </div>
          ) : null}
          {!previewUrl && !cropUrl ? (
            <div className="flex min-h-[5rem] items-center justify-center rounded-lg border border-slate-200/80 bg-slate-100/80 px-4">
              <div className="text-center">
                <svg className="mx-auto mb-2 h-10 w-10 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                <div className="text-xs font-medium text-gray-500">No images yet</div>
                <div className="mt-1 text-[10px] text-gray-400">Loading or not published</div>
              </div>
            </div>
          ) : null}
        </div>

        {/* Confidence + severity — compact */}
        <div className="grid grid-cols-2 gap-2">
          <div className="flex flex-col rounded-lg border border-slate-200/80 bg-white p-2">
            <div className={lbl}>Detection confidence</div>
            <p className="mt-0.5 line-clamp-2 text-[10px] leading-tight text-slate-500">{confidenceSource}</p>
            <div className="mt-1.5 text-xl font-semibold tabular-nums text-slate-900">
              {confidencePct.toFixed(fusionYoloPct != null ? 1 : 0)}%
            </div>
            <Progress
              value={Math.min(100, Math.max(0, confidencePct))}
              className="mt-1.5 h-0.5 bg-slate-200/80 [&>div]:bg-slate-800"
            />
          </div>

          <div
            className={cn(
              'flex flex-col justify-between rounded-lg border border-slate-200/80 bg-white p-2',
              pothole.severity === 'critical' && 'border-red-200/50 bg-red-50/25',
              pothole.severity === 'high' && 'border-orange-200/50 bg-orange-50/25',
              pothole.severity === 'medium' && 'border-amber-200/50 bg-amber-50/25',
              pothole.severity === 'low' && 'border-emerald-200/50 bg-emerald-50/20'
            )}
          >
            <div className={lbl}>Severity</div>
            <div className="mt-1.5 flex items-center gap-1.5">
              <div className={cn('h-2 w-2 shrink-0 rounded-full', getSeverityColor(pothole.severity))} />
              <span className="text-sm font-semibold capitalize text-slate-900">{pothole.severity}</span>
            </div>
          </div>
        </div>

        {/* 3D + fusion measurements — readable, not product jargon */}
        {pothole.fusion && (
          <div className="select-text rounded-lg border border-slate-200/80 bg-slate-50/40 p-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-semibold text-slate-900">3D surface estimate</span>
              {pothole.fusion.fusionOk !== null && (
                <span
                  className={cn(
                    'shrink-0 rounded-md px-2 py-0.5 text-[10px] font-medium',
                    pothole.fusion.fusionOk
                      ? 'bg-emerald-100/80 text-emerald-800'
                      : 'bg-rose-100/80 text-rose-800'
                  )}
                >
                  {pothole.fusion.fusionOk ? 'Passed' : 'Needs review'}
                </span>
              )}
            </div>
            <p className="mt-0.5 text-[10px] leading-snug text-slate-500">
              From a road scan matched to the camera view.
            </p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <div>
                <div className={lbl}>Surface area</div>
                <p className="mt-0.5 text-sm font-semibold tabular-nums text-slate-900">
                  {pothole.fusion.surfaceAreaM2 != null
                    ? `${pothole.fusion.surfaceAreaM2.toFixed(2)} m²`
                    : '—'}
                </p>
                {pothole.fusion.surfaceAreaIsEstimate ? (
                  <p className="mt-0.5 text-[10px] leading-snug text-amber-700/90">
                    Rectangle estimate (width × length); segmentation area was unavailable.
                  </p>
                ) : null}
              </div>
              <div>
                <div className={lbl}>Width × length</div>
                <p className="mt-0.5 text-sm font-semibold tabular-nums text-slate-900">
                  {pothole.fusion.widthM != null && pothole.fusion.lengthM != null
                    ? `${Math.round(pothole.fusion.widthM * 100)} × ${Math.round(pothole.fusion.lengthM * 100)} cm`
                    : '—'}
                </p>
              </div>
            </div>
          </div>
        )}

        <Separator className="my-1" />

        {/* Timeline — primary place for reported time (no duplicate under title) */}
        <div className="rounded-lg border border-slate-200/80 bg-white p-2">
          <h4 className={cn('mb-2', lbl)}>Report & repair</h4>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <div className={cn('mb-0.5', lbl)}>Reported</div>
              <p className="text-[12px] font-medium leading-snug text-slate-900">
                {formatDate(pothole.reportDate)}
              </p>
            </div>
            <div>
              <div className={cn('mb-0.5', lbl)}>Scheduled</div>
              <p className="text-[12px] font-medium leading-snug text-slate-900">
                {formatDate(pothole.scheduledRepairDate)}
              </p>
            </div>
          </div>
        </div>

        {pothole.description && (
          <div className="rounded-lg border border-slate-200/80 bg-white p-2">
            <h4 className={cn('mb-1.5', lbl)}>Description</h4>
            <p className="text-[13px] leading-relaxed text-slate-700">{pothole.description}</p>
          </div>
        )}

        {/* Location last — after context */}
        <div className="rounded-lg border border-slate-200/80 bg-white px-2 py-1.5">
          <div className="flex gap-1.5">
            <MapPin className="mt-0.5 h-2.5 w-2.5 shrink-0 text-slate-400" strokeWidth={1.5} aria-hidden />
            <div className="min-w-0 flex-1 space-y-1">
              <span className={lbl}>Location</span>
              {pothole.location.address ? (
                <p className="text-[12px] font-medium leading-snug text-slate-900">{pothole.location.address}</p>
              ) : null}
              <p className="text-[10px] text-slate-400">Coordinates</p>
              <p className="max-w-full break-all text-[11px] leading-snug text-slate-600">
                {pothole.location.lat.toFixed(5)}, {pothole.location.lng.toFixed(5)}
              </p>
            </div>
          </div>
        </div>
      </CardContent>
      </div>

      <CardFooter
        className="flex shrink-0 flex-col gap-1.5 border-t border-slate-100/90 bg-white/95 px-0 pb-0 pt-2"
        style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
      >
        <div className="flex w-full flex-col gap-1.5 sm:flex-row sm:justify-between">
          <Button
            variant="outline"
            size="sm"
            className="h-9 w-full rounded-lg border-slate-200 text-xs text-slate-700 hover:bg-slate-50 sm:flex-1"
            onClick={onClose}
          >
            Close
          </Button>
          {onUpdateStatus && pothole.status !== 'completed' && (
            <Button
              size="sm"
              className="h-9 w-full rounded-lg bg-slate-900 text-xs text-white hover:bg-slate-800 sm:flex-1"
              onClick={() => {
                const nextStatus = (): Pothole['status'] => {
                  switch (pothole.status) {
                    case 'reported': return 'inspected';
                    case 'inspected': return 'scheduled';
                    case 'scheduled': return 'in-progress';
                    case 'in-progress': return 'completed';
                    default: return 'reported';
                  }
                };

                onUpdateStatus(pothole.id, nextStatus());
              }}
            >
              {pothole.status === 'reported' && 'Mark as Inspected'}
              {pothole.status === 'inspected' && 'Schedule Repair'}
              {pothole.status === 'scheduled' && 'Start Repair'}
              {pothole.status === 'in-progress' && 'Mark as Completed'}
            </Button>
          )}
        </div>
        {onDeletePothole ? (
          <div className="flex justify-center pt-0.5">
            <button
              type="button"
              className="text-[11px] text-slate-400 underline-offset-2 hover:text-slate-600 hover:underline"
              onClick={() => setDeleteOpen(true)}
            >
              Remove from database
            </button>
          </div>
        ) : null}
      </CardFooter>

      <Dialog
        open={deleteOpen}
        onOpenChange={(open) => {
          if (!open && deleteBusy) return;
          setDeleteOpen(open);
        }}
      >
        <DialogContent
          className="sm:max-w-md"
          onPointerDownOutside={(e) => deleteBusy && e.preventDefault()}
          onEscapeKeyDown={(e) => deleteBusy && e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>Delete this pothole?</DialogTitle>
            <DialogDescription>
              This will remove pothole #{pothole.id.slice(0, 8)} from the database. Linked documents and
              processing tasks are unlinked, not deleted. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              onClick={() => setDeleteOpen(false)}
              disabled={deleteBusy}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={deleteBusy}
              onClick={() => {
                void (async () => {
                  if (!onDeletePothole) return;
                  setDeleteBusy(true);
                  try {
                    await onDeletePothole(pothole.id);
                    setDeleteOpen(false);
                  } catch {
                    /* parent toast */
                  } finally {
                    setDeleteBusy(false);
                  }
                })();
              }}
            >
              {deleteBusy ? 'Deleting…' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={lightbox !== null} onOpenChange={(open) => !open && setLightbox(null)}>
        <DialogContent
          className={cn(
            'max-h-[min(90vh,100%)] w-auto max-w-[min(100vw-1rem,96rem)] gap-0 overflow-hidden border-0 bg-transparent p-2 shadow-none sm:rounded-lg',
            '[&>button]:text-white [&>button]:hover:bg-white/15 [&>button]:hover:opacity-100'
          )}
        >
          <DialogTitle className="sr-only">
            {lightbox ? `${lightbox.label} — full size` : 'Image'}
          </DialogTitle>
          {lightbox ? (
            lightbox.detection ? (
              <ImageWithBboxOverlay
                src={lightbox.src}
                alt={lightbox.label}
                detection={lightbox.detection}
                imgClassName="max-h-[85vh] w-full max-w-full object-contain"
              />
            ) : (
              <img
                src={lightbox.src}
                alt={lightbox.label}
                className="max-h-[85vh] w-full max-w-full object-contain"
              />
            )
          ) : null}
        </DialogContent>
      </Dialog>
    </Card>
  );
};

export default PotholeDetails;
