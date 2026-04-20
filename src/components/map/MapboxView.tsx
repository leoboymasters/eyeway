import React, { useEffect, useRef, useState, forwardRef, useImperativeHandle } from 'react';
import { mapboxgl, getMapboxAccessToken } from '@/lib/mapbox';
import { getPotholeDetailsSidebarInsetPx } from '@/lib/mapLayout';
import { cn } from '@/lib/utils';
import { Pothole } from '@/types';
import 'mapbox-gl/dist/mapbox-gl.css';

const SEVERITY_COLORS = {
  low: '#22c55e',
  medium: '#eab308',
  high: '#f97316',
  critical: '#ef4444',
} as const;

function SeverityLegend({
  expanded,
  onHover,
  className,
}: {
  expanded: boolean;
  onHover: (open: boolean) => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'cursor-pointer overflow-hidden rounded-2xl border border-white/30 bg-white/20 shadow-2xl backdrop-blur-xl transition-all duration-300 ease-in-out',
        className
      )}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
    >
      {!expanded ? (
        <div className="flex space-x-2 px-3 py-2">
          <div className="h-3 w-3 rounded-full border border-white shadow-sm" style={{ backgroundColor: SEVERITY_COLORS.low }} title="Low" />
          <div className="h-3 w-3 rounded-full border border-white shadow-sm" style={{ backgroundColor: SEVERITY_COLORS.medium }} title="Medium" />
          <div className="h-3 w-3 rounded-full border border-white shadow-sm" style={{ backgroundColor: SEVERITY_COLORS.high }} title="High" />
          <div className="h-3 w-3 rounded-full border border-white shadow-sm" style={{ backgroundColor: SEVERITY_COLORS.critical }} title="Critical" />
        </div>
      ) : (
        <div className="px-4 py-3">
          <div className="mb-3 text-xs font-semibold">Severity Legend</div>
          <div className="space-y-2">
            <div className="flex items-center space-x-2">
              <div className="h-3 w-3 rounded-full border border-white" style={{ backgroundColor: SEVERITY_COLORS.low }} />
              <span className="text-xs">Low</span>
            </div>
            <div className="flex items-center space-x-2">
              <div className="h-3 w-3 rounded-full border border-white" style={{ backgroundColor: SEVERITY_COLORS.medium }} />
              <span className="text-xs">Medium</span>
            </div>
            <div className="flex items-center space-x-2">
              <div className="h-3 w-3 rounded-full border border-white" style={{ backgroundColor: SEVERITY_COLORS.high }} />
              <span className="text-xs">High</span>
            </div>
            <div className="flex items-center space-x-2">
              <div className="h-3 w-3 rounded-full border border-white" style={{ backgroundColor: SEVERITY_COLORS.critical }} />
              <span className="text-xs">Critical</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

interface MapboxViewProps {
  potholes: Pothole[];
  onSelectPothole: (pothole: Pothole) => void;
  /** When null, map padding is cleared; when set (desktop), padding matches the details rail so centering stays correct. */
  selectedPotholeId?: string | null;
}

export interface MapboxViewRef {
  toggleViewMode: () => void;
  getCurrentMode: () => boolean;
  closePopup: () => void;
}

export const MapboxView = forwardRef<MapboxViewRef, MapboxViewProps>(({ potholes, onSelectPothole, selectedPotholeId = null }, ref) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<{ [key: string]: mapboxgl.Marker }>({});
  const popupRef = useRef<mapboxgl.Popup | null>(null);
  const [isMapLoaded, setIsMapLoaded] = useState(false);
  const [isLegendExpanded, setIsLegendExpanded] = useState(false);
  const [is3DMode, setIs3DMode] = useState(true);
  const [mapError, setMapError] = useState<string | null>(null);

  useImperativeHandle(ref, () => ({
    toggleViewMode: () => {
      if (!mapRef.current) return;

      const map = mapRef.current;
      const newMode = !is3DMode;
      setIs3DMode(newMode);

      if (newMode) {
        // Switch to 3D mode
        map.setPitch(60);
        map.setBearing(0);

        // Add 3D terrain if not already present
        if (!map.getSource('mapbox-dem')) {
          map.addSource('mapbox-dem', {
            type: 'raster-dem',
            url: 'mapbox://mapbox.mapbox-terrain-dem-v1',
            tileSize: 512,
            maxzoom: 14
          });
        }
        map.setTerrain({ source: 'mapbox-dem', exaggeration: 1.5 });

        // Add 3D buildings if not already present
        if (!map.getLayer('add-3d-buildings')) {
          const layers = map.getStyle().layers;
          const labelLayerId = layers?.find(
            (layer: any) => layer.type === 'symbol' && layer.layout && layer.layout['text-field']
          )?.id;

          map.addLayer(
            {
              id: 'add-3d-buildings',
              source: 'composite',
              'source-layer': 'building',
              filter: ['==', 'extrude', 'true'],
              type: 'fill-extrusion',
              minzoom: 15,
              paint: {
                'fill-extrusion-color': '#aaa',
                'fill-extrusion-height': [
                  'interpolate',
                  ['linear'],
                  ['zoom'],
                  15,
                  0,
                  15.05,
                  ['get', 'height']
                ],
                'fill-extrusion-base': [
                  'interpolate',
                  ['linear'],
                  ['zoom'],
                  15,
                  0,
                  15.05,
                  ['get', 'min_height']
                ],
                'fill-extrusion-opacity': 0.6
              }
            },
            labelLayerId
          );
        }

        // Add atmospheric fog
        map.setFog({
          range: [0.5, 10],
          color: '#ffffff',
          'horizon-blend': 0.1,
          'high-color': '#245bde',
          'space-color': '#000000',
          'star-intensity': 0.15
        });
      } else {
        // Switch to 2D mode
        map.setPitch(0);
        map.setBearing(0);

        // Remove terrain
        if (map.getTerrain()) {
          map.setTerrain(null);
        }

        // Remove 3D buildings layer
        if (map.getLayer('add-3d-buildings')) {
          map.removeLayer('add-3d-buildings');
        }

        // Remove fog
        map.setFog(null);
      }
    },
    getCurrentMode: () => is3DMode,
    closePopup: () => {
      if (popupRef.current) {
        popupRef.current.remove();
        popupRef.current = null;
      }
    }
  }));

  // Iligan City center coordinates
  const iliganCity = {
    lat: 8.228,
    lng: 124.2452
  };

  // Toggle between 2D and 3D modes
  const toggleViewMode = () => {
    if (!mapRef.current) return;

    const map = mapRef.current;
    const newMode = !is3DMode;
    setIs3DMode(newMode);

    if (newMode) {
      // Switch to 3D mode
      map.setPitch(60);
      map.setBearing(0);

      // Add 3D terrain if not already present
      if (!map.getSource('mapbox-dem')) {
        map.addSource('mapbox-dem', {
          type: 'raster-dem',
          url: 'mapbox://mapbox.mapbox-terrain-dem-v1',
          tileSize: 512,
          maxzoom: 14
        });
      }
      map.setTerrain({ source: 'mapbox-dem', exaggeration: 1.5 });

      // Add 3D buildings if not already present
      if (!map.getLayer('add-3d-buildings')) {
        const layers = map.getStyle().layers;
        const labelLayerId = layers?.find(
          (layer: any) => layer.type === 'symbol' && layer.layout && layer.layout['text-field']
        )?.id;

        map.addLayer(
          {
            id: 'add-3d-buildings',
            source: 'composite',
            'source-layer': 'building',
            filter: ['==', 'extrude', 'true'],
            type: 'fill-extrusion',
            minzoom: 15,
            paint: {
              'fill-extrusion-color': '#aaa',
              'fill-extrusion-height': [
                'interpolate',
                ['linear'],
                ['zoom'],
                15,
                0,
                15.05,
                ['get', 'height']
              ],
              'fill-extrusion-base': [
                'interpolate',
                ['linear'],
                ['zoom'],
                15,
                0,
                15.05,
                ['get', 'min_height']
              ],
              'fill-extrusion-opacity': 0.6
            }
          },
          labelLayerId
        );
      }

      // Add atmospheric fog
      map.setFog({
        range: [0.5, 10],
        color: '#ffffff',
        'horizon-blend': 0.1,
        'high-color': '#245bde',
        'space-color': '#000000',
        'star-intensity': 0.15
      });
    } else {
      // Switch to 2D mode
      map.setPitch(0);
      map.setBearing(0);

      // Remove terrain
      if (map.getTerrain()) {
        map.setTerrain(null);
      }

      // Remove 3D buildings layer
      if (map.getLayer('add-3d-buildings')) {
        map.removeLayer('add-3d-buildings');
      }

      // Remove fog
      map.setFog(null);
    }
  };

  useEffect(() => {
    if (!mapContainerRef.current) return;

    const MAPBOX_TOKEN = getMapboxAccessToken();
    if (!MAPBOX_TOKEN) {
      setMapError(
        "Mapbox token not configured. Add VITE_MAPBOX_ACCESS_TOKEN in Vercel → Project → Settings → Environment Variables, then redeploy."
      );
      return;
    }
    mapboxgl.accessToken = MAPBOX_TOKEN;

    let map: mapboxgl.Map;
    try {
      map = new mapboxgl.Map({
        container: mapContainerRef.current,
        style: "mapbox://styles/mapbox/light-v11",
        center: [iliganCity.lng, iliganCity.lat],
        zoom: 15.5,
        pitch: is3DMode ? 60 : 0,
        bearing: -20,
        attributionControl: false,
      });
    } catch (err) {
      console.error("Mapbox Map constructor failed:", err);
      setMapError(
        err instanceof Error
          ? err.message
          : "Map failed to initialize. Check the browser console."
      );
      return;
    }

    mapRef.current = map;

    const onWinResize = () => map.resize();
    window.addEventListener("resize", onWinResize);

    map.on("error", (e) => {
      console.error("Mapbox error:", e);
      const msg = (e as { error?: { message?: string } }).error?.message;
      if (msg?.includes("Unauthorized") || msg?.includes("token")) {
        setMapError(
          "Mapbox rejected this token. Check Mapbox URL allowlist includes your Vercel URL (e.g. https://*.vercel.app/*)."
        );
      }
    });

    // Handle map load
    map.on("load", () => {
      map.resize();
      requestAnimationFrame(() => map.resize());
      setIsMapLoaded(true);

      // Hide business/commercial POI labels, road names, and water body names
      const layers = map.getStyle().layers;
      layers.forEach((layer: any) => {
        // Hide business/commercial place labels, road names, and water body names
        if (layer.id.includes('poi-label') ||
            layer.id.includes('place_label_business') ||
            layer.id.includes('place_label_commercial') ||
            layer.id.includes('place_label_commerce') ||
            layer.id.includes('business') ||
            layer.id.includes('commercial') ||
            layer.id.includes('road-label') ||
            (layer.id.includes('road') && layer.id.includes('label')) ||
            layer.id.includes('water-label') ||
            layer.id.includes('waterway-label') ||
            (layer.id.includes('water') && layer.id.includes('label'))) {
          map.setLayoutProperty(layer.id, 'visibility', 'none');
        }

        // Blueprint styling - make roads darker for better visibility
        if (layer.id.includes('road-highway') ||
            layer.id.includes('highway') ||
            layer.id.includes('motorway')) {
          if (layer.type === 'line') {
            map.setPaintProperty(layer.id, 'line-color', '#d1d5db'); // Darker gray for highways
            map.setPaintProperty(layer.id, 'line-width', 3); // Thicker highways
          }
        }

        // Make other roads darker gray
        if ((layer.id.includes('road') && !layer.id.includes('highway') && !layer.id.includes('motorway')) ||
            layer.id.includes('street') ||
            layer.id.includes('primary') ||
            layer.id.includes('secondary') ||
            layer.id.includes('tertiary')) {
          if (layer.type === 'line') {
            map.setPaintProperty(layer.id, 'line-color', '#9ca3af'); // Darker gray for roads
          }
        }

        // Make water bodies light blue for blueprint effect
        if (layer.id.includes('water') && layer.type === 'fill') {
          map.setPaintProperty(layer.id, 'fill-color', '#dbeafe'); // Light blue
        }

        // Make background more blueprint-like (light blue-gray)
        if (layer.id.includes('background')) {
          map.setPaintProperty(layer.id, 'background-color', '#f8fafc'); // Very light blue-gray
        }
      });

      // Add 3D features only if in 3D mode
      if (is3DMode) {
        // Add 3D terrain
        map.addSource('mapbox-dem', {
          type: 'raster-dem',
          url: 'mapbox://mapbox.mapbox-terrain-dem-v1',
          tileSize: 512,
          maxzoom: 14
        });

        map.setTerrain({ source: 'mapbox-dem', exaggeration: 1.5 });

        // Add 3D buildings layer
        const layers = map.getStyle().layers;
        const labelLayerId = layers?.find(
          (layer: any) => layer.type === 'symbol' && layer.layout && layer.layout['text-field']
        )?.id;

        map.addLayer(
          {
            id: 'add-3d-buildings',
            source: 'composite',
            'source-layer': 'building',
            filter: ['==', 'extrude', 'true'],
            type: 'fill-extrusion',
            minzoom: 14,
            paint: {
              'fill-extrusion-color': '#aaa',
              'fill-extrusion-height': [
                'interpolate',
                ['linear'],
                ['zoom'],
                14,
                0,
                14.5,
                ['get', 'height']
              ],
              'fill-extrusion-base': [
                'interpolate',
                ['linear'],
                ['zoom'],
                14,
                0,
                14.5,
                ['get', 'min_height']
              ],
              'fill-extrusion-opacity': 0.6
            }
          },
          labelLayerId
        );

        // Add atmospheric styling for better 3D effect
        map.setFog({
          range: [0.5, 10],
          color: '#ffffff',
          'horizon-blend': 0.1,
          'high-color': '#245bde',
          'space-color': '#000000',
          'star-intensity': 0.15
        });
      }
    });

    return () => {
      window.removeEventListener("resize", onWinResize);
      map.remove();
    };
  }, []);

  // Clear right padding when the details rail closes (padding persists after easeTo until reset).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !isMapLoaded) return;
    if (selectedPotholeId != null) return;
    map.setPadding({ top: 0, bottom: 0, left: 0, right: 0 });
  }, [selectedPotholeId, isMapLoaded]);

  // While a pothole is selected, keep right padding in sync with viewport (sidebar uses min(24rem, 100vw - 1.5rem)).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !isMapLoaded || !selectedPotholeId) return;

    const syncPadding = () => {
      const isDesktop = window.matchMedia("(min-width: 768px)").matches;
      if (!isDesktop) {
        map.setPadding({ top: 0, bottom: 0, left: 0, right: 0 });
        return;
      }
      map.setPadding({
        top: 0,
        bottom: 0,
        left: 0,
        right: getPotholeDetailsSidebarInsetPx(),
      });
    };

    window.addEventListener("resize", syncPadding);
    return () => window.removeEventListener("resize", syncPadding);
  }, [selectedPotholeId, isMapLoaded]);

  // Update markers when potholes change
  useEffect(() => {
    if (!mapRef.current || !isMapLoaded) return;

    // Clear existing markers
    Object.values(markersRef.current).forEach(marker => marker.remove());
    markersRef.current = {};

    // Add markers for potholes with road-embedded style
    potholes.forEach(pothole => {
      // Create the marker container
      const el = document.createElement('div');
      el.className = 'pothole-marker';
      el.style.cursor = 'pointer';

      // Create simple dot
      const color = SEVERITY_COLORS[pothole.severity as keyof typeof SEVERITY_COLORS] || '#3b82f6';

      const dot = document.createElement('div');
      dot.style.cssText = `
        width: 12px;
        height: 12px;
        background-color: ${color};
        border-radius: 50%;
        border: 2px solid white;
        transition: transform 0.2s;
      `;

      el.appendChild(dot);

      el.addEventListener('mouseenter', () => {
        dot.style.transform = 'scale(1.3)';
      });

      el.addEventListener('mouseleave', () => {
        dot.style.transform = 'scale(1)';
      });

      el.addEventListener('click', (e) => {
        e.stopPropagation();
        onSelectPothole(pothole);

        const map = mapRef.current;
        if (map) {
          const isDesktop = typeof window !== "undefined" && window.matchMedia("(min-width: 768px)").matches;
          const rightPad = isDesktop ? getPotholeDetailsSidebarInsetPx() : 0;
          map.easeTo({
            center: [pothole.location.lng, pothole.location.lat],
            duration: 650,
            essential: true,
            ...(rightPad > 0
              ? {
                  padding: { top: 0, bottom: 0, left: 0, right: rightPad },
                }
              : {}),
          });
        }

        // Remove existing popup
        if (popupRef.current) {
          popupRef.current.remove();
        }

        // Create popup content with simple styling
        const popupContent = `
          <div class="p-4 min-w-[200px] pr-10">
            <div class="flex items-start justify-between mb-3 gap-3">
              <h3 class="font-bold text-lg text-gray-900 flex-1">Pothole #${pothole.id.slice(0, 8)}</h3>
              <div class="w-3 h-3 rounded-full flex-shrink-0 mt-1" style="background-color: ${color}; box-shadow: 0 0 8px ${color}80"></div>
            </div>

            <div>
              <div class="text-xs text-gray-500 uppercase tracking-wide mb-1">Severity</div>
              <div class="flex items-center gap-2">
                <div class="w-2 h-2 rounded-full" style="background-color: ${color}"></div>
                <span class="font-semibold uppercase text-sm" style="color: ${color}">${pothole.severity}</span>
              </div>
            </div>
          </div>
        `;

        // Create and show popup with improved styling
        const popup = new mapboxgl.Popup({
          offset: 35,
          className: 'pothole-popup-enhanced',
          closeButton: true,
          closeOnClick: false,
          maxWidth: '320px'
        })
          .setLngLat([pothole.location.lng, pothole.location.lat])
          .setHTML(popupContent)
          .addTo(mapRef.current!);

        popupRef.current = popup;
      });

      // Create marker with custom element, centered on road surface
      const marker = new mapboxgl.Marker({
        element: el,
        anchor: 'center',  // Center anchor so it sits flat on the road
        pitchAlignment: 'map',  // Align with map to follow terrain
        rotationAlignment: 'map'  // Rotate with map to align with surface
      })
        .setLngLat([pothole.location.lng, pothole.location.lat])
        .addTo(mapRef.current!);

      markersRef.current[pothole.id] = marker;
    });
  }, [potholes, isMapLoaded, onSelectPothole]);

  return (
    <div className="fixed inset-0 z-0">
      {mapError && (
        <div className="absolute inset-0 z-[500] flex items-center justify-center bg-slate-100 p-6 text-center">
          <div className="max-w-md rounded-xl border border-amber-200 bg-white p-6 shadow-lg">
            <p className="font-semibold text-slate-900">Map could not load</p>
            <p className="mt-2 text-sm text-slate-600">{mapError}</p>
          </div>
        </div>
      )}
      <div
        ref={mapContainerRef}
        className="absolute inset-0 min-h-[100dvh] w-full"
        style={{ minHeight: "100dvh" }}
      />

      {/* Mobile: legend bottom-right (avoids Index bottom-left controls) */}
      <SeverityLegend
        expanded={isLegendExpanded}
        onHover={setIsLegendExpanded}
        className="absolute bottom-8 right-4 z-[400] md:hidden"
      />

      {/* Desktop: legend + 3D mode stacked bottom-left — keeps clear of pothole details rail on the right */}
      <div className="pointer-events-none absolute bottom-4 left-4 z-[400] hidden md:flex md:flex-col md:items-start md:gap-2 pb-[max(0px,env(safe-area-inset-bottom))]">
        <SeverityLegend
          expanded={isLegendExpanded}
          onHover={setIsLegendExpanded}
          className="pointer-events-auto w-fit"
        />
        <div
          className="pointer-events-auto w-fit cursor-pointer rounded-full bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg transition-all hover:bg-blue-700 active:scale-95"
          onClick={toggleViewMode}
          title={`Click to switch to ${is3DMode ? '2D' : '3D'} mode`}
        >
          {is3DMode ? '3D Mode' : '2D Mode'}
        </div>
      </div>
    </div>
  );
});

MapboxView.displayName = 'MapboxView';

export default MapboxView;
