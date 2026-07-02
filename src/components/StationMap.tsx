import React, { useState, useEffect, useRef } from 'react';
import * as L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Map as MapIcon, Upload, Trash2, Compass } from 'lucide-react';

export interface StationGeoInfo {
  station: string;
  longitude: number;
  latitude: number;
}

interface StationMapProps {
  stations: StationGeoInfo[];
  selectedStation: string;
  selectedStationsMulti: string[];
  focusedStation1D: string;
  stationMode1D: 'single' | 'multi';
  onSelectStation: (stationName: string) => void;
  onToggleStationMulti: (stationName: string) => void;
}

export function StationMap({
  stations,
  selectedStation,
  selectedStationsMulti,
  focusedStation1D,
  stationMode1D,
  onSelectStation,
  onToggleStationMulti,
}: StationMapProps) {
  const [activeTab, setActiveTab] = useState<'online' | 'offline'>('online');
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerGroupRef = useRef<L.FeatureGroup | null>(null);
  const pathLineRef = useRef<L.Polyline | null>(null);

  // Offline Image State
  const [bgImage, setBgImage] = useState<string | null>(() => {
    return localStorage.getItem('ocean_offline_map_img');
  });
  // Coordinates mapping: { [stationName]: { x: number, y: number } } (percentages)
  const [offlineCoords, setOfflineCoords] = useState<Record<string, { x: number; y: number }>>(() => {
    const saved = localStorage.getItem('ocean_offline_map_coords');
    return saved ? JSON.parse(saved) : {};
  });

  const [activeOfflineStation, setActiveOfflineStation] = useState<string>('');

  // Persist offline state
  useEffect(() => {
    if (bgImage) {
      localStorage.setItem('ocean_offline_map_img', bgImage);
    } else {
      localStorage.removeItem('ocean_offline_map_img');
    }
  }, [bgImage]);

  useEffect(() => {
    localStorage.setItem('ocean_offline_map_coords', JSON.stringify(offlineCoords));
  }, [offlineCoords]);

  // Handle Image Upload
  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        if (event.target?.result) {
          setBgImage(event.target.result as string);
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const clearOfflineMap = () => {
    if (confirm('确定要清除上传的离线背景图和所有标记吗？')) {
      setBgImage(null);
      setOfflineCoords({});
    }
  };

  // Click on offline image to place marker
  const handleOfflineImageClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const stationToPlace = activeOfflineStation || selectedStation || (stations.length > 0 ? stations[0].station : '');
    if (!stationToPlace) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;

    setOfflineCoords((prev) => ({
      ...prev,
      [stationToPlace]: { x, y },
    }));
  };

  // Initialize Leaflet Map
  useEffect(() => {
    if (activeTab !== 'online' || !mapContainerRef.current) {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
      return;
    }

    // Only create map if it doesn't exist
    if (!mapRef.current) {
      mapRef.current = L.map(mapContainerRef.current, {
        zoomControl: true,
        attributionControl: false,
      }).setView([20, 115], 5); // Default focus (e.g. South China Sea)

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 18,
      }).addTo(mapRef.current);

      markerGroupRef.current = L.featureGroup().addTo(mapRef.current);
    }

    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, [activeTab]);

  // Update Map Markers and Path when stations change
  useEffect(() => {
    if (activeTab !== 'online' || !mapRef.current || !markerGroupRef.current) return;

    const markerGroup = markerGroupRef.current;
    markerGroup.clearLayers();

    if (pathLineRef.current) {
      pathLineRef.current.remove();
      pathLineRef.current = null;
    }

    const validStations = stations.filter((s) => !isNaN(s.latitude) && !isNaN(s.longitude));
    if (validStations.length === 0) return;

    const coordinates: L.LatLngTuple[] = [];

    validStations.forEach((s) => {
      const latlng: L.LatLngTuple = [s.latitude, s.longitude];
      coordinates.push(latlng);

      const isSelected = stationMode1D === 'single'
        ? selectedStation === s.station
        : selectedStationsMulti.includes(s.station);

      const isFocused = focusedStation1D === s.station;

      // Styling parameters
      let color = '#2563eb'; // Default royal blue
      let radius = 6;
      let weight = 1.5;
      let fillOpacity = 0.7;

      if (isFocused) {
        color = '#dc2626'; // Highlight red
        radius = 9;
        fillOpacity = 0.9;
        weight = 3;
      } else if (isSelected) {
        color = stationMode1D === 'single' ? '#ef4444' : '#16a34a'; // Red for single, green for multi
        radius = 8;
        fillOpacity = 0.85;
        weight = 2;
      }

      // Create a CircleMarker instead of default icon to avoid Vite asset issues and look cleaner
      const marker = L.circleMarker(latlng, {
        radius,
        fillColor: color,
        color: '#ffffff',
        weight,
        opacity: 1,
        fillOpacity,
      });

      // Bind simple tooltip
      marker.bindTooltip(
        `<div style="font-family: var(--font-sans); font-size: 11px; padding: 2px 4px;">
          <strong>${s.station}</strong><br/>
          经度: ${s.longitude.toFixed(4)}°E<br/>
          纬度: ${s.latitude.toFixed(4)}°N
        </div>`,
        { direction: 'top', offset: [0, -5] }
      );

      // Event binding
      marker.on('click', () => {
        if (stationMode1D === 'single') {
          onSelectStation(s.station);
        } else {
          onToggleStationMulti(s.station);
        }
      });

      markerGroup.addLayer(marker);
    });

    // Draw route path line linking stations
    if (coordinates.length > 1) {
      pathLineRef.current = L.polyline(coordinates, {
        color: '#94a3b8',
        weight: 1.5,
        dashArray: '5, 5',
        opacity: 0.8,
      }).addTo(mapRef.current);
    }

    // Fit bounds automatically
    try {
      const bounds = markerGroup.getBounds();
      if (bounds.isValid()) {
        mapRef.current.fitBounds(bounds, { padding: [30, 30] });
      }
    } catch (e) {
      console.warn('Could not fit map bounds:', e);
    }
  }, [stations, selectedStation, selectedStationsMulti, focusedStation1D, stationMode1D, activeTab]);

  return (
    <div
      className="card"
      style={{
        marginTop: '20px',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        padding: '16px',
        background: 'var(--bg-secondary)',
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--border-color)',
        boxShadow: 'var(--shadow-sm)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Compass size={18} style={{ color: 'var(--primary)' }} />
          <h4 style={{ margin: 0, fontSize: '14px', fontWeight: 600 }}>站位地理空间对应图</h4>
        </div>
        
        {/* Mode Switch Tabs */}
        <div style={{ display: 'flex', background: 'var(--bg-tertiary)', padding: '2px', borderRadius: '6px', fontSize: '12px' }}>
          <button
            style={{
              padding: '4px 12px',
              border: 'none',
              background: activeTab === 'online' ? 'var(--bg-secondary)' : 'transparent',
              color: activeTab === 'online' ? 'var(--text-primary)' : 'var(--text-secondary)',
              borderRadius: '4px',
              cursor: 'pointer',
              fontWeight: activeTab === 'online' ? 500 : 400,
              boxShadow: activeTab === 'online' ? 'var(--shadow-sm)' : 'none',
              transition: 'var(--transition-fast)',
            }}
            onClick={() => setActiveTab('online')}
          >
            在线交互式地图
          </button>
          <button
            style={{
              padding: '4px 12px',
              border: 'none',
              background: activeTab === 'offline' ? 'var(--bg-secondary)' : 'transparent',
              color: activeTab === 'offline' ? 'var(--text-primary)' : 'var(--text-secondary)',
              borderRadius: '4px',
              cursor: 'pointer',
              fontWeight: activeTab === 'offline' ? 500 : 400,
              boxShadow: activeTab === 'offline' ? 'var(--shadow-sm)' : 'none',
              transition: 'var(--transition-fast)',
            }}
            onClick={() => setActiveTab('offline')}
          >
            离线/自定义底图
          </button>
        </div>
      </div>

      {/* Main Map Areas */}
      {activeTab === 'online' ? (
        <div style={{ position: 'relative', width: '100%', borderRadius: '8px', overflow: 'hidden', border: '1px solid var(--border-color)' }}>
          <div ref={mapContainerRef} style={{ height: '320px', width: '100%', zIndex: 1 }} />
          {stations.length === 0 && (
            <div
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                background: 'rgba(255, 255, 255, 0.85)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--text-secondary)',
                fontSize: '13px',
                zIndex: 2,
              }}
            >
              未检测到含经纬度的站位数据，请确保上传的数据包含经度/纬度。
            </div>
          )}
        </div>
      ) : (
        <div style={{ display: 'flex', gap: '16px', minHeight: '320px', flexWrap: 'wrap' }}>
          {/* Left panel: List & tools */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', flex: '1 1 240px', minWidth: '220px' }}>
            {!bgImage ? (
              <div
                style={{
                  border: '2px dashed var(--border-color)',
                  borderRadius: '8px',
                  padding: '24px',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '10px',
                  flex: 1,
                  background: 'var(--bg-primary)',
                  textAlign: 'center',
                }}
              >
                <Upload size={32} style={{ color: 'var(--text-muted)' }} />
                <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                  请上传一张航线图或工况示意图作为底图
                </div>
                <label
                  className="btn btn-secondary"
                  style={{
                    padding: '6px 16px',
                    fontSize: '12px',
                    cursor: 'pointer',
                    background: 'var(--bg-secondary)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '6px',
                  }}
                >
                  选择图片文件
                  <input type="file" accept="image/*" onChange={handleImageUpload} style={{ display: 'none' }} />
                </label>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', flex: 1 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '12px', fontWeight: 500 }}>打点标定工具</span>
                  <button
                    onClick={clearOfflineMap}
                    style={{
                      border: 'none',
                      background: 'none',
                      color: 'var(--danger)',
                      fontSize: '11px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                      cursor: 'pointer',
                    }}
                  >
                    <Trash2 size={12} />
                    清除底图
                  </button>
                </div>

                <div style={{ fontSize: '11px', color: 'var(--text-secondary)', background: 'var(--bg-tertiary)', padding: '8px', borderRadius: '6px' }}>
                  💡 <strong>操作提示：</strong>在右侧列表中选中一个站位，然后点击底图上对应的实际位置，即可完成打点标定。
                </div>

                {/* Station coordinate status list */}
                <div style={{ flex: 1, maxHeight: '200px', overflowY: 'auto', border: '1px solid var(--border-color)', borderRadius: '6px', padding: '4px' }}>
                  {stations.map((s) => {
                    const hasCoord = !!offlineCoords[s.station];
                    const isSelected = activeOfflineStation === s.station || (!activeOfflineStation && selectedStation === s.station);
                    return (
                      <div
                        key={s.station}
                        onClick={() => setActiveOfflineStation(s.station)}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          padding: '6px 8px',
                          borderRadius: '4px',
                          cursor: 'pointer',
                          fontSize: '12px',
                          background: isSelected ? 'var(--primary-light)' : 'transparent',
                          color: isSelected ? 'var(--primary-hover)' : 'var(--text-primary)',
                        }}
                      >
                        <span>{s.station}</span>
                        <span style={{ fontSize: '10px', color: hasCoord ? 'var(--success)' : 'var(--text-muted)' }}>
                          {hasCoord ? '已标定' : '未标定'}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Right panel: Background image workspace */}
          <div
            style={{
              flex: '2 1 450px',
              position: 'relative',
              borderRadius: '8px',
              border: '1px solid var(--border-color)',
              background: '#f8fafc',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              overflow: 'hidden',
              minHeight: '320px',
            }}
          >
            {bgImage ? (
              <div
                onClick={handleOfflineImageClick}
                style={{
                  position: 'relative',
                  cursor: 'crosshair',
                  display: 'inline-block',
                  maxWidth: '100%',
                  maxHeight: '320px',
                }}
              >
                <img
                  src={bgImage}
                  alt="Custom Map Background"
                  style={{
                    display: 'block',
                    maxWidth: '100%',
                    maxHeight: '320px',
                    objectFit: 'contain',
                    pointerEvents: 'none', // Prevents image drag
                  }}
                />

                {/* Overlaid Markers */}
                {stations.map((s) => {
                  const coord = offlineCoords[s.station];
                  if (!coord) return null;

                  const isSelected = stationMode1D === 'single'
                    ? selectedStation === s.station
                    : selectedStationsMulti.includes(s.station);
                  
                  const isFocused = focusedStation1D === s.station;

                  return (
                    <div
                      key={s.station}
                      onClick={(e) => {
                        e.stopPropagation(); // Avoid re-placing marker
                        if (stationMode1D === 'single') {
                          onSelectStation(s.station);
                        } else {
                          onToggleStationMulti(s.station);
                        }
                        setActiveOfflineStation(s.station);
                      }}
                      style={{
                        position: 'absolute',
                        left: `${coord.x}%`,
                        top: `${coord.y}%`,
                        transform: 'translate(-50%, -50%)',
                        width: isFocused ? '18px' : isSelected ? '14px' : '10px',
                        height: isFocused ? '18px' : isSelected ? '14px' : '10px',
                        borderRadius: '50%',
                        backgroundColor: isFocused ? '#dc2626' : isSelected ? (stationMode1D === 'single' ? '#ef4444' : '#16a34a') : '#2563eb',
                        border: '2px solid #ffffff',
                        boxShadow: '0 2px 4px rgba(0,0,0,0.3)',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        transition: 'all 0.15s ease',
                        zIndex: isFocused ? 10 : isSelected ? 9 : 5,
                      }}
                      title={s.station}
                    >
                      {/* Label tooltip */}
                      <span
                        style={{
                          position: 'absolute',
                          top: '100%',
                          left: '50%',
                          transform: 'translateX(-50%)',
                          whiteSpace: 'nowrap',
                          background: 'rgba(15, 23, 42, 0.8)',
                          color: '#ffffff',
                          fontSize: '8px',
                          padding: '1px 4px',
                          borderRadius: '3px',
                          marginTop: '2px',
                          pointerEvents: 'none',
                        }}
                      >
                        {s.station}
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div style={{ color: 'var(--text-muted)', fontSize: '13px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
                <MapIcon size={24} />
                <span>等待底图上传...</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Map Legend */}
      <div style={{ display: 'flex', gap: '16px', fontSize: '11px', color: 'var(--text-secondary)', borderTop: '1px solid var(--border-color)', paddingTop: '10px', flexWrap: 'wrap', justifyContent: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', background: '#2563eb' }} />
          <span>普通观测站</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', background: '#ef4444' }} />
          <span>当前选中站位</span>
        </div>
        {stationMode1D === 'multi' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', background: '#16a34a' }} />
            <span>多选对比站位</span>
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', background: '#dc2626' }} />
          <span>当前聚焦高亮站位</span>
        </div>
      </div>
    </div>
  );
}
