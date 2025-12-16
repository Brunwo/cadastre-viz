import React, { useState, useCallback } from 'react';
import { parseParcelText } from './services/geminiService';
import { parseParcelTextRegex } from './services/regexService';
import { getInseeCode, getParcelGeometry } from './services/cadastreService';
import { ParsedParcel, ParseStatus } from './types';
import ParcelMap from './components/ParcelMap';
import { Map, Loader2, FileText, Sparkles, Copy, Ruler, Download, Zap, CheckCircle2, AlertCircle } from 'lucide-react';
import JSZip from 'jszip';

const ExampleData = `SCHORBACH S C N° 0584
NOUSSEVILLER-LES-BITCHE S 10 N° 0123
LENGELSHEIM Section B N° 45`;

// --- Geometry Helper (Pure JS, no Leaflet dependency for List) ---
const calculateGeoJsonArea = (geoJson: any): number => {
  if (!geoJson) return 0;
  
  const earthRadius = 6378137;
  let totalArea = 0;

  const getRingArea = (coords: any[]) => {
    let area = 0;
    if (coords.length > 2) {
      for (let i = 0; i < coords.length; i++) {
        const [p1Lng, p1Lat] = coords[i];
        const [p2Lng, p2Lat] = coords[(i + 1) % coords.length];
        
        area += ((p2Lng - p1Lng) * (Math.PI / 180)) *
                (2 + Math.sin(p1Lat * (Math.PI / 180)) + Math.sin(p2Lat * (Math.PI / 180)));
      }
      area = area * earthRadius * earthRadius / 2.0;
    }
    return Math.abs(area);
  };

  const features = geoJson.type === 'FeatureCollection' ? geoJson.features : [geoJson];

  features.forEach((f: any) => {
    if (!f.geometry) return;
    const geom = f.geometry;
    
    if (geom.type === 'Polygon') {
      totalArea += getRingArea(geom.coordinates[0]); // Exterior ring
    } else if (geom.type === 'MultiPolygon') {
      geom.coordinates.forEach((poly: any[]) => {
        totalArea += getRingArea(poly[0]);
      });
    }
  });

  return totalArea;
};

const formatArea = (areaSqM: number): string => {
  if (areaSqM === 0) return '';
  if (areaSqM > 10000) {
    return `${(areaSqM / 10000).toFixed(4)} ha`;
  }
  return `${Math.round(areaSqM).toLocaleString()} m²`;
};

// --- GPX Generation Helper ---
const createGpxContent = (parcel: ParsedParcel): string => {
  if (!parcel.geoJson) return '';
  
  const name = `${parcel.communeName} ${parcel.section} ${parcel.numero}`;
  let segments = '';

  const addRing = (ring: any[]) => {
    let pts = '';
    ring.forEach(coord => {
      // GeoJSON is [lng, lat], GPX wants lat, lon
      pts += `<trkpt lat="${coord[1]}" lon="${coord[0]}"><ele>0</ele></trkpt>`;
    });
    return `<trkseg>${pts}</trkseg>`;
  };

  const features = parcel.geoJson.type === 'FeatureCollection' 
      ? parcel.geoJson.features 
      : [parcel.geoJson];

  features.forEach((f: any) => {
      if (!f.geometry) return;
      const geom = f.geometry;
      if (geom.type === 'Polygon') {
        // Use all rings (exterior + holes) as segments for the track
        geom.coordinates.forEach((ring: any[]) => {
          segments += addRing(ring);
        });
      } else if (geom.type === 'MultiPolygon') {
        geom.coordinates.forEach((poly: any[]) => {
            poly.forEach((ring: any[]) => {
              segments += addRing(ring);
            });
        });
      }
  });

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="CadastreViz">
  <metadata>
    <name>${name}</name>
  </metadata>
  <trk>
    <name>${name}</name>
    ${segments}
  </trk>
</gpx>`;
};

export default function App() {
  const [inputText, setInputText] = useState<string>('');
  const [parcels, setParcels] = useState<ParsedParcel[]>([]);
  const [appStatus, setAppStatus] = useState<ParseStatus>(ParseStatus.IDLE);
  const [progressMessage, setProgressMessage] = useState<string>('');
  const [isMapFullscreen, setIsMapFullscreen] = useState<boolean>(false);
  const [selectedParcelId, setSelectedParcelId] = useState<string | null>(null);
  const [measurementsVisibleIds, setMeasurementsVisibleIds] = useState<Set<string>>(new Set());
  const [useAiParsing, setUseAiParsing] = useState<boolean>(true);
  
  // Filter state for the list view only
  const [listFilter, setListFilter] = useState<'all' | 'success' | 'error'>('all');

  const handleProcess = useCallback(async () => {
    if (!inputText.trim()) return;

    setAppStatus(ParseStatus.PARSING_TEXT);
    setParcels([]); // Clear previous
    setSelectedParcelId(null); 
    setMeasurementsVisibleIds(new Set());

    try {
      let parsedRaw: Array<{ communeName: string; section: string; numero: string }> = [];

      if (useAiParsing) {
        setProgressMessage('Asking AI to interpret parcel data...');
        // 1. Parse text with Gemini
        parsedRaw = await parseParcelText(inputText);
      } else {
        setProgressMessage('Parsing text locally...');
        // 1. Parse text with Regex
        parsedRaw = parseParcelTextRegex(inputText);
        
        if (parsedRaw.length === 0) {
           throw new Error("No parcels detected using Regex mode. Try checking your format or enable AI analysis.");
        }
      }
      
      const initialParcels: ParsedParcel[] = parsedRaw.map((p, idx) => ({
        id: `p-${idx}-${Date.now()}`,
        rawText: `${p.communeName} ${p.section} ${p.numero}`,
        communeName: p.communeName,
        section: p.section,
        numero: p.numero,
        status: 'pending'
      }));

      setParcels(initialParcels);

      // 2. Fetch data for each parcel sequentially or in parallel batches
      setAppStatus(ParseStatus.FETCHING_INSEE);
      setProgressMessage('Resolving INSEE codes and geometries...');

      const updatedParcels = [...initialParcels];

      for (let i = 0; i < updatedParcels.length; i++) {
        const p = updatedParcels[i];
        
        updatedParcels[i] = { ...p, status: 'loading' };
        setParcels([...updatedParcels]);

        const insee = await getInseeCode(p.communeName);
        
        if (!insee) {
          updatedParcels[i] = { 
            ...p, 
            status: 'error', 
            errorMessage: 'Commune not found' 
          };
          continue;
        }

        const geoJson = await getParcelGeometry(insee, p.section, p.numero);

        if (geoJson && geoJson.features && geoJson.features.length > 0) {
           updatedParcels[i] = {
             ...p,
             inseeCode: insee,
             geoJson: geoJson,
             status: 'success'
           };
        } else {
           updatedParcels[i] = {
             ...p,
             inseeCode: insee,
             status: 'error',
             errorMessage: 'Parcel geometry not found in Cadastre'
           };
        }
        
        setParcels([...updatedParcels]);
      }

      setAppStatus(ParseStatus.COMPLETED);
      setProgressMessage('Processing complete.');

    } catch (error: any) {
      console.error(error);
      setAppStatus(ParseStatus.IDLE);
      setProgressMessage(error.message || 'An error occurred during processing.');
    }
  }, [inputText, useAiParsing]);

  const loadExample = () => {
    setInputText(ExampleData);
  };

  const handleParcelClick = (parcel: ParsedParcel) => {
    if (parcel.status === 'success') {
      setSelectedParcelId(parcel.id);
      // On mobile, scroll to map. On desktop, map is visible.
      if (window.innerWidth < 1024) {
        window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
      }
    }
  };

  const toggleMeasurements = (e: React.MouseEvent, id: string) => {
    e.stopPropagation(); // Prevent triggering selection
    setMeasurementsVisibleIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // Derive filtered list
  const filteredParcels = parcels.filter(p => {
    if (listFilter === 'all') return true;
    return p.status === listFilter;
  });

  const handleCopyList = () => {
    const textToCopy = filteredParcels
      .map(p => `${p.communeName} Section ${p.section} N° ${p.numero}`)
      .join('\n');
    navigator.clipboard.writeText(textToCopy);
    alert(`Copied ${filteredParcels.length} lines to clipboard!`);
  };

  const handleExportGPX = async () => {
    const successParcels = parcels.filter(p => p.status === 'success' && p.geoJson);
    if (successParcels.length === 0) {
      alert("No valid parcels with geometry found to export.");
      return;
    }

    const zip = new JSZip();

    successParcels.forEach(p => {
      const gpxContent = createGpxContent(p);
      const cleanName = `${p.communeName}-${p.section}-${p.numero}`
        .replace(/\s+/g, '_')
        .replace(/[^a-z0-9_\-\.]/gi, '');
      
      zip.file(`${cleanName}.gpx`, gpxContent);
    });

    try {
      const content = await zip.generateAsync({ type: "blob" });
      const url = window.URL.createObjectURL(content);
      const a = document.createElement("a");
      a.href = url;
      a.download = `parcels_export_${new Date().toISOString().slice(0, 10)}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Failed to generate zip", err);
      alert("Error generating ZIP file.");
    }
  };

  const stats = {
    total: parcels.length,
    success: parcels.filter(p => p.status === 'success').length,
    error: parcels.filter(p => p.status === 'error').length,
    pending: parcels.filter(p => p.status === 'pending' || p.status === 'loading').length
  };

  return (
    <div className="flex flex-col h-screen font-sans text-gray-800 bg-slate-50 overflow-hidden">
      {/* Header - Fixed Height, Full Width */}
      <header className="bg-white border-b border-gray-200 px-6 py-4 flex-shrink-0 z-20 shadow-sm">
        <div className="w-full flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-blue-600 p-2 rounded-lg text-white">
              <Map size={24} />
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-900 leading-tight">CadastreViz France</h1>
              <p className="text-xs text-gray-500 font-medium">IGN / Data.gouv.fr API Connector</p>
            </div>
          </div>
                </div>
      </header>

      {/* Main Content - Flex Row on Desktop */}
      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden relative w-full">
        
        {/* Sidebar Panel - Fixed width on Desktop */}
        <div 
          className="bg-white lg:bg-gray-50 flex-shrink-0 flex flex-col gap-4 border-b lg:border-b-0 lg:border-r border-gray-200 w-full lg:w-[420px] p-4 lg:p-6 overflow-y-auto h-1/2 lg:h-full z-10"
        >
          {/* Input Section */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
            <div className="flex justify-between items-center mb-4">
              <h2 className="font-semibold flex items-center gap-2">
                <FileText size={18} className="text-blue-600" />
                Data Input
              </h2>
              <button 
                onClick={loadExample} 
                className="text-xs text-blue-600 hover:text-blue-800 underline font-medium"
              >
                Load Example
              </button>
            </div>
            
            <textarea
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder="Paste list of parcels here...&#10;e.g., SCHORBACH S C N° 0584"
              className="w-full h-32 p-3 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none resize-none font-mono bg-gray-50"
            />
            
            {/* Analysis Switch */}
            <div className="flex items-center justify-between bg-gray-50 p-3 rounded-lg border border-gray-200 mt-4">
              <div className="flex items-center gap-2">
                {useAiParsing ? <Sparkles size={18} className="text-purple-600" /> : <Zap size={18} className="text-orange-500" />}
                <div className="flex flex-col">
                   <span className="text-sm font-semibold text-gray-700">AI Analysis</span>
                   <span className="text-[10px] text-gray-500">{useAiParsing ? "Formatting with Gemini" : "Fast Regex Match"}</span>
                </div>
              </div>
              
              <button 
                onClick={() => setUseAiParsing(!useAiParsing)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${useAiParsing ? 'bg-purple-600' : 'bg-gray-300'}`}
              >
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${useAiParsing ? 'translate-x-6' : 'translate-x-1'}`} />
              </button>
            </div>

            <button
              onClick={handleProcess}
              disabled={appStatus !== ParseStatus.IDLE && appStatus !== ParseStatus.COMPLETED}
              className={`mt-4 w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg text-white font-medium transition-all ${
                appStatus !== ParseStatus.IDLE && appStatus !== ParseStatus.COMPLETED
                  ? 'bg-blue-400 cursor-not-allowed' 
                  : 'bg-blue-600 hover:bg-blue-700 shadow-md hover:shadow-lg active:scale-95'
              }`}
            >
              {appStatus !== ParseStatus.IDLE && appStatus !== ParseStatus.COMPLETED ? (
                <>
                  <Loader2 size={18} className="animate-spin" />
                  Processing...
                </>
              ) : (
                <>
                  <Map size={18} />
                  Map Parcels
                </>
              )}
            </button>

            {/* Progress Status */}
            {(appStatus !== ParseStatus.IDLE) && (
              <div className="mt-3 p-3 bg-blue-50 text-blue-700 text-xs rounded-md flex items-center gap-2">
                <Loader2 size={14} className={appStatus === ParseStatus.COMPLETED ? "hidden" : "animate-spin"} />
                {progressMessage}
              </div>
            )}
          </div>

          {/* Results List */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 flex flex-col flex-1 min-h-[300px]">
             
             {/* List Header & Controls */}
             <div className="p-4 border-b border-gray-100 flex justify-between items-center bg-gray-50/50 rounded-t-xl">
               <div className="flex items-center gap-2 text-sm text-gray-600 font-medium">
                  <span>Results</span>
                  <span className="bg-gray-200 text-gray-700 px-2 py-0.5 rounded-full text-xs">{stats.total}</span>
               </div>
               
               <div className="flex items-center gap-2">
                 <div className="flex bg-gray-100 p-0.5 rounded-lg border border-gray-200">
                    <button 
                      onClick={() => setListFilter('all')}
                      className={`px-2 py-1 rounded-md text-xs font-medium transition-all ${listFilter === 'all' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                    >
                      All
                    </button>
                    <button 
                      onClick={() => setListFilter('success')}
                      className={`px-2 py-1 rounded-md text-xs font-medium transition-all ${listFilter === 'success' ? 'bg-white text-green-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                    >
                      OK
                    </button>
                    <button 
                      onClick={() => setListFilter('error')}
                      className={`px-2 py-1 rounded-md text-xs font-medium transition-all ${listFilter === 'error' ? 'bg-white text-red-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                    >
                      Err
                    </button>
                 </div>
                 
                 <button 
                  onClick={handleCopyList} 
                  className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-md transition-colors"
                  title="Copy list to clipboard"
                 >
                   <Copy size={16} />
                 </button>

                 <button 
                  onClick={handleExportGPX} 
                  className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-md transition-colors"
                  title="Export GPX (ZIP)"
                 >
                   <Download size={16} />
                 </button>
               </div>
             </div>

             {/* List Items */}
             <div className="overflow-y-auto flex-1 p-2 space-y-2">
                {filteredParcels.length === 0 && parcels.length > 0 && (
                  <div className="text-center py-10 text-gray-400 text-sm">
                    No parcels match filter.
                  </div>
                )}
                
                {parcels.length === 0 && appStatus === ParseStatus.IDLE && (
                   <div className="text-center py-10 text-gray-400 text-sm">
                     Waiting for input...
                   </div>
                )}

                {filteredParcels.map((parcel) => (
                  <div 
                    key={parcel.id}
                    onClick={() => handleParcelClick(parcel)}
                    className={`
                      relative p-3 rounded-lg border cursor-pointer transition-all duration-200 group
                      ${parcel.id === selectedParcelId ? 'ring-2 ring-blue-500 border-transparent bg-blue-50 shadow-md' : 'border-gray-100 hover:border-blue-300 hover:shadow-sm bg-white'}
                    `}
                  >
                    <div className="flex justify-between items-start">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          {parcel.status === 'success' && <CheckCircle2 size={16} className="text-green-500" />}
                          {parcel.status === 'error' && <AlertCircle size={16} className="text-red-500" />}
                          {parcel.status === 'loading' && <Loader2 size={16} className="text-blue-500 animate-spin" />}
                          {parcel.status === 'pending' && <div className="w-4 h-4 rounded-full border-2 border-gray-300" />}
                          
                          <h3 className="font-bold text-gray-800 text-sm">{parcel.communeName}</h3>
                        </div>
                        
                        <div className="text-xs text-gray-600 flex gap-4 ml-6">
                           <span className="bg-gray-100 px-1.5 py-0.5 rounded border border-gray-200">S: <b>{parcel.section}</b></span>
                           <span className="bg-gray-100 px-1.5 py-0.5 rounded border border-gray-200">N°: <b>{parcel.numero}</b></span>
                        </div>

                        {parcel.errorMessage && (
                          <div className="text-[10px] text-red-500 mt-2 ml-6 bg-red-50 p-1 rounded inline-block">
                             {parcel.errorMessage}
                          </div>
                        )}

                        {parcel.status === 'success' && (
                           <div className="mt-2 ml-6 text-sm font-semibold text-blue-700 bg-blue-50/50 p-1 rounded w-fit">
                             Area: {formatArea(calculateGeoJsonArea(parcel.geoJson))}
                           </div>
                        )}
                      </div>
                      
                      {/* Action Buttons */}
                      <div className="flex flex-col gap-1 items-end">
                        <span className="text-[10px] text-gray-400 font-mono">
                           {parcel.status === 'success' && parcel.inseeCode ? `INSEE: ${parcel.inseeCode}` : ''}
                        </span>

                         {parcel.status === 'success' && (
                           <button
                             onClick={(e) => toggleMeasurements(e, parcel.id)}
                             className={`
                               p-1.5 rounded-md transition-all mt-1 flex items-center gap-1 text-xs border
                               ${measurementsVisibleIds.has(parcel.id) 
                                 ? 'bg-blue-600 text-white border-blue-600 shadow-sm' 
                                 : 'bg-white text-gray-400 border-gray-200 hover:text-blue-600 hover:border-blue-300'}
                             `}
                             title={measurementsVisibleIds.has(parcel.id) ? "Hide measurements" : "Show measurements"}
                           >
                             <Ruler size={14} />
                             {measurementsVisibleIds.has(parcel.id) && <span>On</span>}
                           </button>
                         )}
                      </div>
                    </div>
                  </div>
                ))}
             </div>
          </div>
        </div>

        {/* Map Panel - Fills Remaining Space */}
        <div className="flex-1 relative bg-gray-100 h-1/2 lg:h-auto w-full">
          <ParcelMap 
            parcels={parcels} 
            selectedParcelId={selectedParcelId}
            measurementsVisibleIds={measurementsVisibleIds}
            isFullscreen={isMapFullscreen}
            onToggleFullscreen={() => setIsMapFullscreen(!isMapFullscreen)}
          />
        </div>

      </div>
    </div>
  );
}