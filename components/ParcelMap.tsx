import React, { useEffect, useRef, useState, useMemo } from 'react';
import { MapContainer, TileLayer, GeoJSON, Popup, useMap, Marker } from 'react-leaflet';
import L from 'leaflet';
import { ParsedParcel } from '../types';
import { Maximize, Minimize, Layers } from 'lucide-react';

// Fix for default Leaflet icon not showing in React/ESM environments
const fixLeafletIcons = () => {
  delete (L.Icon.Default.prototype as any)._getIconUrl;
  L.Icon.Default.mergeOptions({
    iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
    iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
    shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  });
};

fixLeafletIcons();

interface ParcelMapProps {
  parcels: ParsedParcel[];
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
  selectedParcelId?: string | null;
  measurementsVisibleIds: Set<string>;
}

// --- Sub-Components ---

const MapBoundsAdjuster: React.FC<{ parcels: ParsedParcel[] }> = ({ parcels }) => {
  const map = useMap();

  useEffect(() => {
    const validParcels = parcels.filter(p => p.geoJson && p.geoJson.features && p.geoJson.features.length > 0);
    
    if (validParcels.length > 0) {
      const group = L.featureGroup();
      validParcels.forEach(p => {
         const layer = L.geoJSON(p.geoJson);
         layer.addTo(group);
      });
      if (group.getLayers().length > 0) {
          map.fitBounds(group.getBounds(), { padding: [50, 50] });
      }
    }
  }, [parcels, map]);

  return null;
};

const ParcelHighlighter: React.FC<{ 
  selectedId?: string | null, 
  layerRefs: React.MutableRefObject<Record<string, L.GeoJSON | null>> 
}> = ({ selectedId, layerRefs }) => {
  const map = useMap();

  useEffect(() => {
    if (selectedId && layerRefs.current[selectedId]) {
      const layer = layerRefs.current[selectedId];
      if (layer) {
        const bounds = layer.getBounds();
        if (bounds.isValid()) {
           map.flyToBounds(bounds, { 
             padding: [200, 200], 
             maxZoom: 19, // Zoom closer to see measurements
             duration: 1.5 
           });
           layer.openPopup();
        }
      }
    }
  }, [selectedId, map, layerRefs]);

  return null;
};

// Component to render measurements (Edge Lengths ONLY) for MULTIPLE parcels
const ParcelMeasurements: React.FC<{ parcels: ParsedParcel[], visibleIds: Set<string> }> = ({ parcels, visibleIds }) => {
  const map = useMap();

  const data = useMemo(() => {
    // Filter to find all parcels that should show measurements
    const targetParcels = parcels.filter(p => visibleIds.has(p.id) && p.geoJson);
    if (targetParcels.length === 0) return null;

    const allEdges = [];

    for (const parcel of targetParcels) {
        const polygons: L.LatLng[][] = [];
        
        const features = parcel.geoJson.type === 'FeatureCollection' 
          ? parcel.geoJson.features 
          : [parcel.geoJson];

        features.forEach((f: any) => {
          if (!f.geometry) return;
          const geom = f.geometry;
          
          const coordsToLatLngs = (ring: any[]) => ring.map((c: any) => new L.LatLng(c[1], c[0]));

          if (geom.type === 'Polygon') {
            polygons.push(coordsToLatLngs(geom.coordinates[0]));
          } else if (geom.type === 'MultiPolygon') {
            geom.coordinates.forEach((poly: any[]) => {
              polygons.push(coordsToLatLngs(poly[0]));
            });
          }
        });

        // Calculate edges for this parcel
        polygons.forEach(ring => {
           for (let i = 0; i < ring.length - 1; i++) {
            const p1 = ring[i];
            const p2 = ring[i + 1];
            const dist = map.distance(p1, p2);
            
            const midLat = (p1.lat + p2.lat) / 2;
            const midLng = (p1.lng + p2.lng) / 2;
            
            if (dist > 2) {
              allEdges.push({
                pos: new L.LatLng(midLat, midLng),
                length: dist,
                parcelId: parcel.id
              });
            }
          }
          // Closing segment
          if (ring.length > 2) {
             const p1 = ring[ring.length - 1];
             const p2 = ring[0];
             const dist = map.distance(p1, p2);
             if (dist > 2) {
                allEdges.push({
                  pos: new L.LatLng((p1.lat + p2.lat)/2, (p1.lng + p2.lng)/2),
                  length: dist,
                  parcelId: parcel.id
                });
             }
          }
        });
    }

    return allEdges;

  }, [parcels, visibleIds, map]);

  if (!data) return null;

  return (
    <>
      {data.map((edge, idx) => (
        <Marker
            key={`edge-${edge.parcelId}-${idx}`}
            position={edge.pos}
            icon={L.divIcon({
              html: `<div class="w-max px-1 bg-white/80 border border-gray-400/50 rounded text-[10px] font-mono text-gray-700 whitespace-nowrap transform -translate-x-1/2 -translate-y-1/2 hover:scale-110 hover:bg-white transition-transform cursor-default shadow-sm">
                      ${Math.round(edge.length)}m
                    </div>`,
              className: '',
              iconSize: [0, 0]
            })}
          />
      ))}
    </>
  );
};

const ParcelMap: React.FC<ParcelMapProps> = ({ parcels, isFullscreen, onToggleFullscreen, selectedParcelId, measurementsVisibleIds }) => {
  const layerRefs = useRef<Record<string, L.GeoJSON | null>>({});
  const [baseLayer, setBaseLayer] = useState<'ign' | 'satellite' | 'osm'>('ign');
  const [showCadastre, setShowCadastre] = useState<boolean>(true);
  const [cadastreOpacity, setCadastreOpacity] = useState<number>(100);
  const [isLayerMenuOpen, setIsLayerMenuOpen] = useState<boolean>(false);

  const getStyle = (parcel: ParsedParcel) => {
    const isSelected = parcel.id === selectedParcelId;
    return {
      fillColor: isSelected ? '#2563eb' : '#3b82f6',
      weight: isSelected ? 4 : 3,
      opacity: 1,
      color: isSelected ? '#1e40af' : '#2563eb', 
      dashArray: '0',
      fillOpacity: isSelected ? 0.2 : 0.4
    };
  };

  // Styles adjusted for full height usage
  const containerClasses = isFullscreen
    ? "fixed inset-0 z-50 h-screen w-screen bg-white" 
    : "h-full w-full bg-white relative z-0";

  return (
    <div className={containerClasses}>
      
      {/* Fullscreen Toggle */}
      <button
        onClick={onToggleFullscreen}
        className="absolute bottom-6 right-6 z-[1000] bg-white p-2.5 rounded-lg shadow-xl border border-gray-300 text-gray-700 hover:text-blue-600 hover:bg-gray-50 transition-all transform hover:scale-105"
        title={isFullscreen ? "Exit Fullscreen" : "Enter Fullscreen"}
      >
        {isFullscreen ? <Minimize size={24} /> : <Maximize size={24} />}
      </button>

      {/* Custom Layer Control Panel */}
      <div 
        className="absolute top-4 right-4 z-[1000] bg-white rounded-lg shadow-xl border border-gray-300 overflow-hidden font-sans text-sm text-gray-700 transition-all"
        onMouseEnter={() => setIsLayerMenuOpen(true)}
        onMouseLeave={() => setIsLayerMenuOpen(false)}
      >
        <div className={`p-2.5 bg-white hover:bg-gray-50 cursor-pointer flex items-center gap-2 ${isLayerMenuOpen ? 'border-b border-gray-200 bg-gray-50' : ''}`}>
           <Layers size={20} className="text-gray-600" />
           {isLayerMenuOpen && <span className="font-semibold text-gray-800">Layers</span>}
        </div>

        {isLayerMenuOpen && (
          <div className="p-3 bg-white min-w-[240px] flex flex-col gap-4">
             {/* Base Layers */}
             <div>
               <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Base Map</h4>
               <div className="space-y-2">
                  <label className="flex items-center gap-2 cursor-pointer hover:text-blue-600 transition-colors">
                     <input type="radio" name="baselayer" checked={baseLayer === 'ign'} onChange={() => setBaseLayer('ign')} className="text-blue-600 focus:ring-blue-500" />
                     <span>Plan IGN (Standard)</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer hover:text-blue-600 transition-colors">
                     <input type="radio" name="baselayer" checked={baseLayer === 'satellite'} onChange={() => setBaseLayer('satellite')} className="text-blue-600 focus:ring-blue-500" />
                     <span>Satellite (Photo)</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer hover:text-blue-600 transition-colors">
                     <input type="radio" name="baselayer" checked={baseLayer === 'osm'} onChange={() => setBaseLayer('osm')} className="text-blue-600 focus:ring-blue-500" />
                     <span>OpenStreetMap</span>
                  </label>
               </div>
             </div>

             {/* Overlays */}
             <div>
               <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Overlays</h4>
               <div className="space-y-3">
                  <div className="bg-gray-50 p-2.5 rounded-md border border-gray-100">
                      <label className="flex items-center gap-2 cursor-pointer mb-2 font-medium text-gray-800">
                         <input type="checkbox" checked={showCadastre} onChange={(e) => setShowCadastre(e.target.checked)} className="rounded text-blue-600 focus:ring-blue-500" />
                         <span>Cadastre (IGN)</span>
                      </label>
                      <div className={`transition-all duration-300 ${showCadastre ? 'opacity-100 max-h-16' : 'opacity-40 max-h-0 overflow-hidden grayscale'}`}>
                         <div className="flex justify-between items-center text-[10px] text-gray-500 mb-1">
                            <span>Transparency</span>
                            <span>{100 - cadastreOpacity}%</span>
                         </div>
                         <input type="range" min="0" max="100" value={cadastreOpacity} onChange={(e) => setCadastreOpacity(Number(e.target.value))} className="w-full h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600" disabled={!showCadastre} />
                      </div>
                  </div>
               </div>
             </div>
          </div>
        )}
      </div>

      <MapContainer center={[46.603354, 1.888334]} zoom={6} style={{ height: "100%", width: "100%" }}>
        <MapBoundsAdjuster parcels={parcels} />
        <ParcelHighlighter selectedId={selectedParcelId} layerRefs={layerRefs} />
        
        {/* Render measurements for ALL visible parcels */}
        <ParcelMeasurements parcels={parcels} visibleIds={measurementsVisibleIds} />

        {baseLayer === 'ign' && <TileLayer url="https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2&STYLE=normal&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=image/png" attribution='&copy; IGN' maxZoom={19} />}
        {baseLayer === 'satellite' && <TileLayer url="https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=ORTHOIMAGERY.ORTHOPHOTOS&STYLE=normal&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=image/jpeg" attribution='&copy; IGN' maxZoom={19} />}
        {baseLayer === 'osm' && <TileLayer attribution='&copy; OSM' url="https://{s}.tile.openstreetmap.fr/osmfr/{z}/{x}/{y}.png" />}

        {showCadastre && <TileLayer url="https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=CADASTRALPARCELS.PARCELS&STYLE=normal&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=image/png" attribution='&copy; IGN' maxZoom={20} zIndex={100} opacity={cadastreOpacity / 100} />}
        
        {parcels.map((parcel) => (
          parcel.geoJson && (
            <GeoJSON 
              key={parcel.id} 
              data={parcel.geoJson}
              style={() => getStyle(parcel)}
              ref={(el) => { if (el) layerRefs.current[parcel.id] = el; }}
            >
              <Popup>
                <div className="p-1 min-w-[150px]">
                  <h3 className="font-bold text-sm text-blue-800 border-b pb-1 mb-1">{parcel.communeName}</h3>
                  <div className="text-xs text-gray-700 space-y-1">
                    <p className="flex justify-between"><span>Section:</span> <span className="font-mono font-bold">{parcel.section}</span></p>
                    <p className="flex justify-between"><span>Numéro:</span> <span className="font-mono font-bold">{parcel.numero}</span></p>
                  </div>
                </div>
              </Popup>
            </GeoJSON>
          )
        ))}
      </MapContainer>
    </div>
  );
};

export default ParcelMap;