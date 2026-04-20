
import React, { useState, useEffect, useRef, useCallback } from 'react';
import Header from '@/components/layout/Header';
import PotholeFilters from '@/components/features/PotholeFilters';
import MapboxView, { MapboxViewRef } from '@/components/map/MapboxView';
import PotholeDetails from '@/components/features/PotholeDetails';
import DataVisualization from '@/components/features/DataVisualization';
import DocumentManagement from '@/components/features/DocumentManagement';
import { Pothole, Status, Severity, PotholeFusion } from '@/types';
import { parseBboxXyxy } from '@/lib/bbox';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { X } from "lucide-react";
import { useIsMobile } from '@/hooks/use-mobile';

/**
 * List query: omit heavy base64 image payloads (`image_url`, `frame_image_url`).
 *
 * Those columns store full JPEGs as `data:image/jpeg;base64,...` strings and
 * can each be 200 KB – 2 MB. Including them in the map list fetch balloons the
 * payload by 100× and turns every realtime event into a huge transfer.
 *
 * `PotholeDetails` refetches the full row (including the image fields) by id
 * when a marker is opened, so the detail view still works without them here.
 */
const POTHOLE_LIST_COLUMNS =
  'id, latitude, longitude, road_id, severity, status, detection_accuracy, report_date, scheduled_repair_date, completion_date, description, reported_by, fusion_ok, surface_area_m2, width_m, length_m, yolo_confidence, source, track_id, model_url, bbox_xyxy, frame_width, frame_height';

const Index = () => {
  const [potholes, setPotholes] = useState<Pothole[]>([]);
  const [filteredPotholes, setFilteredPotholes] = useState<Pothole[]>([]);
  const [selectedPothole, setSelectedPothole] = useState<Pothole | null>(null);
  const [severityFilter, setSeverityFilter] = useState<Severity | 'all'>('all');
  const [statusFilter, setStatusFilter] = useState<Status | 'all'>('all');
  const [activePanel, setActivePanel] = useState<'filters' | 'data' | 'documents' | null>(null);
  const { toast } = useToast();
  const toastRef = useRef(toast);
  toastRef.current = toast;
  const isMobile = useIsMobile();
  const mapRef = useRef<MapboxViewRef>(null);
  const [isMap3DMode, setIsMap3DMode] = useState(true); // Default to 3D mode

  /** Load potholes from Supabase (same query on mount, on tab focus, and on realtime events). */
  const fetchPotholes = useCallback(async () => {
    try {
      let { data, error } = await supabase.from('potholes').select(POTHOLE_LIST_COLUMNS);

      if (error) {
        const fallback = await supabase.from('potholes').select('*');
        data = fallback.data;
        error = fallback.error;
      }

      if (error) {
        throw error;
      }

      if (data) {
        // Transform Supabase data to match our Pothole type
        const transformedData: Pothole[] = data.map(item => {
          const dbArea =
            item.surface_area_m2 != null && Number.isFinite(Number(item.surface_area_m2))
              ? Number(item.surface_area_m2)
              : null;
          const wM = item.width_m != null && Number.isFinite(Number(item.width_m)) ? Number(item.width_m) : null;
          const lM = item.length_m != null && Number.isFinite(Number(item.length_m)) ? Number(item.length_m) : null;
          const estArea =
            dbArea == null && wM != null && lM != null && wM > 0 && lM > 0 ? wM * lM : null;
          const surfaceAreaM2 = dbArea ?? estArea;
          const surfaceAreaIsEstimate = dbArea == null && estArea != null;

          const fusion: PotholeFusion | undefined =
            item.fusion_ok != null ||
            item.surface_area_m2 != null ||
            item.yolo_confidence != null ||
            estArea != null
              ? {
                  fusionOk: item.fusion_ok ?? null,
                  surfaceAreaM2: surfaceAreaM2 ?? null,
                  surfaceAreaIsEstimate: surfaceAreaIsEstimate || undefined,
                  widthM: item.width_m ?? null,
                  lengthM: item.length_m ?? null,
                  yoloConfidence: item.yolo_confidence ?? null,
                  source: item.source ?? null,
                  trackId: item.track_id ?? null,
                }
              : undefined;

          // Image fields are intentionally omitted from the list query;
          // PotholeDetails re-fetches the selected row by id to populate them.
          const rawImageUrl = 'image_url' in item ? (item as { image_url?: string | null }).image_url : null;
          const rawFrameImageUrl = 'frame_image_url' in item
            ? (item as { frame_image_url?: string | null }).frame_image_url
            : null;

          return {
            id: item.id,
            location: {
              lat: Number(item.latitude),
              lng: Number(item.longitude),
              roadId: item.road_id,
              address: item.road_id,
            },
            severity: item.severity as Severity,
            status: item.status as Status,
            detectionAccuracy: item.detection_accuracy / 100,
            reportDate: item.report_date,
            scheduledRepairDate: item.scheduled_repair_date || undefined,
            completionDate: item.completion_date || undefined,
            images: rawImageUrl ? [rawImageUrl] : [],
            frameImageUrl: rawFrameImageUrl != null ? String(rawFrameImageUrl) : undefined,
            description: item.description || undefined,
            reportedBy: item.reported_by || undefined,
            fusion,
            model_url: item.model_url || undefined,
            bboxXyxy: parseBboxXyxy('bbox_xyxy' in item ? item.bbox_xyxy : null),
            frameWidth:
              'frame_width' in item && item.frame_width != null && Number.isFinite(Number(item.frame_width))
                ? Number(item.frame_width)
                : null,
            frameHeight:
              'frame_height' in item && item.frame_height != null && Number.isFinite(Number(item.frame_height))
                ? Number(item.frame_height)
                : null,
          };
        });

        setPotholes(transformedData);
      }
    } catch (error: unknown) {
      console.error('Error fetching potholes:', error);
      const detail =
        error &&
        typeof error === 'object' &&
        'message' in error &&
        typeof (error as { message: unknown }).message === 'string'
          ? (error as { message: string }).message
          : error instanceof Error
            ? error.message
            : 'Could not load potholes data. Please try again later.';
      toastRef.current({
        variant: "destructive",
        title: "Error fetching potholes",
        description: detail,
      });
    }
  }, []);

  useEffect(() => {
    fetchPotholes();
  }, [fetchPotholes]);

  // Refetch when returning to the tab — inserts from the edge CLI do not push to this SPA otherwise.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        fetchPotholes();
      }
    };
    window.addEventListener('focus', fetchPotholes);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('focus', fetchPotholes);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [fetchPotholes]);

  // Apply realtime changes incrementally so a single insert does not drag the
  // entire pothole list (including base64 images) back over the wire.
  // Requires Realtime enabled for `potholes` in Supabase.
  useEffect(() => {
    const channel = supabase
      .channel('potholes-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'potholes' },
        async (payload) => {
          if (payload.eventType === 'DELETE') {
            const deletedId =
              (payload.old && typeof payload.old === 'object' && 'id' in payload.old
                ? (payload.old as { id?: string }).id
                : undefined) ?? undefined;
            if (deletedId) {
              setPotholes((prev) => prev.filter((p) => p.id !== deletedId));
            }
            return;
          }

          const changedId =
            (payload.new && typeof payload.new === 'object' && 'id' in payload.new
              ? (payload.new as { id?: string }).id
              : undefined) ?? undefined;
          if (!changedId) {
            // Unknown shape — fall back to a full refetch.
            fetchPotholes();
            return;
          }

          // Refetch just the changed row with the lightweight list columns so
          // we patch local state in place.
          try {
            let { data, error } = await supabase
              .from('potholes')
              .select(POTHOLE_LIST_COLUMNS)
              .eq('id', changedId)
              .maybeSingle();
            if (error) {
              const fb = await supabase
                .from('potholes')
                .select('*')
                .eq('id', changedId)
                .maybeSingle();
              data = fb.data;
              error = fb.error;
            }
            if (error || !data) return;

            const dbArea =
              data.surface_area_m2 != null && Number.isFinite(Number(data.surface_area_m2))
                ? Number(data.surface_area_m2)
                : null;
            const wM = data.width_m != null && Number.isFinite(Number(data.width_m)) ? Number(data.width_m) : null;
            const lM = data.length_m != null && Number.isFinite(Number(data.length_m)) ? Number(data.length_m) : null;
            const estArea =
              dbArea == null && wM != null && lM != null && wM > 0 && lM > 0 ? wM * lM : null;
            const surfaceAreaM2 = dbArea ?? estArea;
            const surfaceAreaIsEstimate = dbArea == null && estArea != null;

            const fusion: PotholeFusion | undefined =
              data.fusion_ok != null ||
              data.surface_area_m2 != null ||
              data.yolo_confidence != null ||
              estArea != null
                ? {
                    fusionOk: data.fusion_ok ?? null,
                    surfaceAreaM2: surfaceAreaM2 ?? null,
                    surfaceAreaIsEstimate: surfaceAreaIsEstimate || undefined,
                    widthM: data.width_m ?? null,
                    lengthM: data.length_m ?? null,
                    yoloConfidence: data.yolo_confidence ?? null,
                    source: data.source ?? null,
                    trackId: data.track_id ?? null,
                  }
                : undefined;

            const rawImageUrl = 'image_url' in data ? (data as { image_url?: string | null }).image_url : null;
            const rawFrameImageUrl = 'frame_image_url' in data
              ? (data as { frame_image_url?: string | null }).frame_image_url
              : null;

            const updated: Pothole = {
              id: data.id,
              location: {
                lat: Number(data.latitude),
                lng: Number(data.longitude),
                roadId: data.road_id,
                address: data.road_id,
              },
              severity: data.severity as Severity,
              status: data.status as Status,
              detectionAccuracy: data.detection_accuracy / 100,
              reportDate: data.report_date,
              scheduledRepairDate: data.scheduled_repair_date || undefined,
              completionDate: data.completion_date || undefined,
              images: rawImageUrl ? [rawImageUrl] : [],
              frameImageUrl: rawFrameImageUrl != null ? String(rawFrameImageUrl) : undefined,
              description: data.description || undefined,
              reportedBy: data.reported_by || undefined,
              fusion,
              model_url: data.model_url || undefined,
              bboxXyxy: parseBboxXyxy('bbox_xyxy' in data ? data.bbox_xyxy : null),
              frameWidth:
                'frame_width' in data && data.frame_width != null && Number.isFinite(Number(data.frame_width))
                  ? Number(data.frame_width)
                  : null,
              frameHeight:
                'frame_height' in data && data.frame_height != null && Number.isFinite(Number(data.frame_height))
                  ? Number(data.frame_height)
                  : null,
            };

            setPotholes((prev) => {
              const idx = prev.findIndex((p) => p.id === updated.id);
              if (idx === -1) return [...prev, updated];
              const next = prev.slice();
              next[idx] = updated;
              return next;
            });
          } catch (e) {
            console.warn('Realtime incremental update failed, falling back to full refetch', e);
            fetchPotholes();
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchPotholes]);

  useEffect(() => {
    // Apply filters
    let filtered = [...potholes];

    if (severityFilter !== 'all') {
      filtered = filtered.filter((p) => p.severity === severityFilter);
    }

    if (statusFilter !== 'all') {
      filtered = filtered.filter((p) => p.status === statusFilter);
    }

    setFilteredPotholes(filtered);
  }, [potholes, severityFilter, statusFilter]);

  const handleSelectPothole = (pothole: Pothole) => {
    setSelectedPothole(pothole);
  };

  const handleClosePothole = () => {
    setSelectedPothole(null);
    mapRef.current?.closePopup();
  };

  const handleDeletePothole = async (id: string) => {
    try {
      const { error: unlinkDocs } = await supabase
        .from('pothole_documents')
        .update({ pothole_id: null })
        .eq('pothole_id', id);
      if (unlinkDocs) {
        console.warn('Unlink pothole_documents:', unlinkDocs);
      }

      const { error: unlinkTasks } = await supabase
        .from('processing_tasks')
        .update({ pothole_id: null })
        .eq('pothole_id', id);
      if (unlinkTasks) {
        console.warn('Unlink processing_tasks:', unlinkTasks);
      }

      const { error } = await supabase.from('potholes').delete().eq('id', id);
      if (error) throw error;

      setPotholes((prev) => prev.filter((p) => p.id !== id));
      setSelectedPothole(null);
      mapRef.current?.closePopup();

      toast({
        title: 'Pothole deleted',
        description: `Removed pothole #${id.slice(0, 8)}.`,
      });
    } catch (error) {
      console.error('Error deleting pothole:', error);
      const detail =
        error &&
        typeof error === 'object' &&
        'message' in error &&
        typeof (error as { message: unknown }).message === 'string'
          ? (error as { message: string }).message
          : 'Could not delete this pothole. Please try again.';
      toast({
        variant: 'destructive',
        title: 'Delete failed',
        description: detail,
      });
      throw error;
    }
  };

  const handleUpdatePotholeStatus = async (id: string, newStatus: Status) => {
    try {
      // Update in Supabase
      const updateData: any = {
        status: newStatus
      };

      // Add dates based on status
      if (newStatus === 'scheduled') {
        updateData.scheduled_repair_date = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
      } else if (newStatus === 'completed') {
        updateData.completion_date = new Date().toISOString();
      }

      const { error } = await supabase
        .from('potholes')
        .update(updateData)
        .eq('id', id);

      if (error) throw error;

      // Update local state
      setPotholes(prev =>
        prev.map(p =>
          p.id === id
            ? {
                ...p,
                status: newStatus,
                scheduledRepairDate: newStatus === 'scheduled'
                  ? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
                  : p.scheduledRepairDate,
                completionDate: newStatus === 'completed'
                  ? new Date().toISOString()
                  : p.completionDate
              }
            : p
        )
      );

      toast({
        title: "Status updated",
        description: `Pothole #${id} is now ${newStatus.replace('-', ' ')}.`,
      });

      // Update selected pothole if it's the one being modified
      setSelectedPothole(prev =>
        prev && prev.id === id
          ? {
              ...prev,
              status: newStatus,
              scheduledRepairDate: newStatus === 'scheduled'
                ? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
                : prev.scheduledRepairDate,
              completionDate: newStatus === 'completed'
                ? new Date().toISOString()
                : prev.completionDate
            }
          : prev
      );
    } catch (error) {
      console.error('Error updating pothole status:', error);
      toast({
        variant: "destructive",
        title: "Update failed",
        description: "Could not update the pothole status. Please try again.",
      });
    }
  };

  const handleClearFilters = () => {
    setSeverityFilter('all');
    setStatusFilter('all');
  };

  const handleToggleViewMode = () => {
    mapRef.current?.toggleViewMode();
    // Update local state to reflect the new mode
    setIsMap3DMode(!isMap3DMode);
  };

  const togglePanel = (panel: 'filters' | 'data' | 'documents') => {
    setActivePanel(activePanel === panel ? null : panel);
  };

  // When the pothole details rail is open (fixed right, z-40), inset floating panels so they
  // don't sit underneath it — matches sidebar: right-3 + w-[min(24rem,calc(100vw-1.5rem))] + gap.
  const desktopFloatingPanelRightClass =
    selectedPothole && !isMobile
      ? 'right-[calc(0.75rem+min(24rem,calc(100vw-1.5rem))+0.5rem)]'
      : 'right-4';

  return (
    <div className="min-h-screen relative overflow-hidden">
      {/* Map mounts immediately so WebGL/tiles initialize in parallel with Supabase (avoids blank canvas from late mount). */}
      <MapboxView
        ref={mapRef}
        potholes={filteredPotholes}
        onSelectPothole={handleSelectPothole}
        selectedPotholeId={selectedPothole?.id ?? null}
      />
      {/* Floating Header with Integrated Controls */}
      <Header
        activePanel={activePanel}
        togglePanel={togglePanel}
        isPotholeDetailsOpen={!!selectedPothole}
      />

      {/* Mobile Control Panel - Bottom */}
      <div className="fixed bottom-4 left-4 z-30 md:hidden flex flex-col gap-2">
        {/* 3D Mode Button */}
        <button
          onClick={handleToggleViewMode}
          className="bg-blue-600 hover:bg-blue-700 text-white px-5 py-2.5 rounded-full font-semibold text-sm shadow-lg transition-all active:scale-95"
        >
          {isMap3DMode ? '3D Mode' : '2D Mode'}
        </button>

        {/* Control Buttons */}
        <div className="bg-white/90 backdrop-blur-lg rounded-2xl shadow-xl p-2 flex flex-col gap-1.5">
          <button
            onClick={() => togglePanel('filters')}
            className={`px-5 py-2.5 text-sm font-medium rounded-xl transition-all ${
              activePanel === 'filters'
                ? 'bg-pothole-500 text-white shadow-md'
                : 'bg-white hover:bg-gray-50'
            }`}
          >
            Filters
          </button>
          <button
            onClick={() => togglePanel('data')}
            className={`px-5 py-2.5 text-sm font-medium rounded-xl transition-all ${
              activePanel === 'data'
                ? 'bg-pothole-500 text-white shadow-md'
                : 'bg-white hover:bg-gray-50'
            }`}
          >
            Data
          </button>
          <button
            onClick={() => togglePanel('documents')}
            className={`px-5 py-2.5 text-sm font-medium rounded-xl transition-all ${
              activePanel === 'documents'
                ? 'bg-pothole-500 text-white shadow-md'
                : 'bg-white hover:bg-gray-50'
            }`}
          >
            Potholes
          </button>
        </div>
      </div>

      {/* Side Slide Pothole Details Panel */}
      {selectedPothole && (
        <div
          className={
            isMobile
              ? 'fixed inset-3 z-40 flex min-h-0 flex-col overflow-hidden rounded-2xl border border-slate-200/90 bg-white/95 shadow-[0_8px_32px_rgba(15,23,42,0.12)] backdrop-blur-md'
              : 'fixed bottom-3 right-3 top-4 z-40 flex w-[min(24rem,calc(100vw-1.5rem))] min-h-0 flex-col overflow-hidden rounded-2xl border border-slate-200/90 bg-white/95 shadow-[0_8px_32px_rgba(15,23,42,0.12)] backdrop-blur-md'
          }
        >
          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden px-3 pt-2 pb-0">
            <PotholeDetails
              pothole={selectedPothole}
              onClose={handleClosePothole}
              onUpdateStatus={handleUpdatePotholeStatus}
              onDeletePothole={handleDeletePothole}
            />
          </div>
        </div>
      )}

      {/* Floating Panels */}
      {activePanel === 'filters' && (
        <div className={`fixed ${
          isMobile
            ? 'inset-x-4 top-20 bottom-4 z-35'
            : `top-24 left-4 max-h-[calc(100vh-8rem)] ${desktopFloatingPanelRightClass}`
        } floating-panel animate-fade-in overflow-hidden`}>
          <div className="relative h-full flex flex-col">
            <button
              onClick={() => setActivePanel(null)}
              className="absolute top-4 right-4 p-2 rounded-full hover:bg-gray-100 transition-colors z-20 bg-white shadow-md"
              aria-label="Close panel"
            >
              <X size={18} />
            </button>
            <div className="flex-1 overflow-y-auto p-4 pr-14 sm:pr-16">
              <PotholeFilters
                severity={severityFilter}
                status={statusFilter}
                onSeverityChange={setSeverityFilter}
                onStatusChange={setStatusFilter}
                onClearFilters={handleClearFilters}
                totalPotholes={potholes.length}
                filteredCount={filteredPotholes.length}
              />
            </div>
          </div>
        </div>
      )}

      {activePanel === 'data' && (
        <div className={`fixed ${
          isMobile
            ? 'inset-x-4 top-20 bottom-4 z-35'
            : `top-24 left-4 max-h-[calc(100vh-8rem)] ${desktopFloatingPanelRightClass}`
        } floating-panel animate-fade-in overflow-hidden`}>
          <div className="relative h-full flex flex-col">
            <button
              onClick={() => setActivePanel(null)}
              className="absolute top-4 right-4 p-2 rounded-full hover:bg-gray-100 transition-colors z-20 bg-white shadow-md"
              aria-label="Close panel"
            >
              <X size={18} />
            </button>
            <div className="flex-1 overflow-y-auto p-4 pr-14 sm:pr-16">
              <DataVisualization potholes={potholes} />
            </div>
          </div>
        </div>
      )}

      {activePanel === 'documents' && (
        <div className={`fixed ${
          isMobile
            ? 'inset-x-4 top-20 bottom-4 z-35'
            : `top-24 left-4 max-h-[calc(100vh-8rem)] ${desktopFloatingPanelRightClass}`
        } floating-panel animate-fade-in overflow-hidden`}>
          <div className="relative h-full flex flex-col">
            <button
              onClick={() => setActivePanel(null)}
              className="absolute top-4 right-4 p-2 rounded-full hover:bg-gray-100 transition-colors z-20 bg-white shadow-md"
              aria-label="Close panel"
            >
              <X size={18} />
            </button>
            {/* pr reserves space for the absolute close control (avoids overlap with header actions) */}
            <div className="flex-1 overflow-y-auto p-4 pr-14 sm:pr-16">
              <DocumentManagement
                potholes={potholes}
                onDeletePothole={handleDeletePothole}
                selectedPotholeId={selectedPothole?.id ?? null}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Index;
