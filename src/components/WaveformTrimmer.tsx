import React, { useRef, useEffect, useState } from 'react';
import { 
  Play, 
  Square, 
  Scissors, 
  RotateCcw, 
  Download, 
  Volume2, 
  Clock, 
  ChevronLeft,
  ChevronRight
} from 'lucide-react';
import { RecordedAudio } from '../types';
import { createWavBlobUrl } from '../utils/wav';

interface WaveformTrimmerProps {
  recordedAudio: RecordedAudio;
  onTrimApply: (trimmedPCM: Float32Array, startPercent: number, endPercent: number) => void;
  onTrimReset: () => void;
  activeTrimStart: number; // 0 to 1
  activeTrimEnd: number;   // 0 to 1
  onChangeTrim: (start: number, end: number) => void;
  onPlayTrimmed: () => void;
  onStopTrimmed: () => void;
  isPlaying: boolean;
  playbackProgressRatio: number | null;
}

export default function WaveformTrimmer({
  recordedAudio,
  onTrimApply,
  onTrimReset,
  activeTrimStart,
  activeTrimEnd,
  onChangeTrim,
  onPlayTrimmed,
  onStopTrimmed,
  isPlaying,
  playbackProgressRatio,
}: WaveformTrimmerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [dragState, setDragState] = useState<'none' | 'start' | 'end'>('none');
  const [hoverState, setHoverState] = useState<'none' | 'start' | 'end'>('none');
  const [ampScale, setAmpScale] = useState<number>(1.2); // Vertical wave helper scale

  const pcm = recordedAudio.pcmData;
  const sampleRate = recordedAudio.sampleRate;
  const duration = recordedAudio.duration;

  // Calculate highlighted audio parameters
  const trimStartSec = (duration * activeTrimStart).toFixed(2);
  const trimEndSec = (duration * activeTrimEnd).toFixed(2);
  const trimmedDuration = (duration * (activeTrimEnd - activeTrimStart)).toFixed(2);

  // Generate WAV downloadable links
  const [downloadUrl, setDownloadUrl] = useState<string>('');
  const [fullDownloadUrl, setFullDownloadUrl] = useState<string>('');

  useEffect(() => {
    // Generate static file URL for full audio
    const urlFull = createWavBlobUrl(pcm, sampleRate);
    setFullDownloadUrl(urlFull);

    return () => {
      URL.revokeObjectURL(urlFull);
    };
  }, [pcm, sampleRate]);

  useEffect(() => {
    // Generate download URL for the TRIMMED slice
    if (pcm.length === 0) return;
    const startIndex = Math.floor(activeTrimStart * pcm.length);
    const endIndex = Math.floor(activeTrimEnd * pcm.length);
    const slicedPcm = pcm.slice(startIndex, endIndex);

    if (slicedPcm.length > 0) {
      const urlTrimmed = createWavBlobUrl(slicedPcm, sampleRate);
      setDownloadUrl(urlTrimmed);

      return () => {
        URL.revokeObjectURL(urlTrimmed);
      };
    }
  }, [pcm, sampleRate, activeTrimStart, activeTrimEnd]);

  // Downsample and paint Waveform on canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Handle High DPI displays
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * window.devicePixelRatio;
    canvas.height = rect.height * window.devicePixelRatio;

    const width = canvas.width;
    const height = canvas.height;
    const centerY = height / 2;

    ctx.fillStyle = '#ffffff'; // Pristine clean minimalist white backdrop
    ctx.fillRect(0, 0, width, height);

    if (pcm.length === 0) return;

    // Subdivide samples into pixel column bins
    const samplesPerPixel = Math.max(1, Math.floor(pcm.length / width));
    
    // Draw waves
    const xStart = activeTrimStart * width;
    const xEnd = activeTrimEnd * width;

    // We can paint column by column
    for (let x = 0; x < width; x++) {
      const startSampleIndex = x * samplesPerPixel;
      let maxVal = 0;
      
      // Look inside column bin to find peak
      for (let s = 0; s < samplesPerPixel; s++) {
        const idx = startSampleIndex + s;
        if (idx >= pcm.length) break;
        const absVal = Math.abs(pcm[idx]);
        if (absVal > maxVal) {
          maxVal = absVal;
        }
      }

      // Amplify amplitude with scale
      const waveHeight = Math.min(height * 0.95, maxVal * (height / 2) * ampScale);
      const isTrimmedOut = x < xStart || x > xEnd;

      // Color nodes based on trim window selection
      if (isTrimmedOut) {
        ctx.strokeStyle = '#e4e4e7'; // Zinc 200 (subtle grey for out-of-bounds)
      } else {
        ctx.strokeStyle = '#18181b'; // Zinc 900 (bold charcoal for selected regions)
      }

      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x, centerY - waveHeight / 2 - 1);
      ctx.lineTo(x, centerY + waveHeight / 2 + 1);
      ctx.stroke();
    }

    // Draw central timeline axis line
    ctx.strokeStyle = 'rgba(24, 24, 27, 0.05)';
    ctx.beginPath();
    ctx.moveTo(0, centerY);
    ctx.lineTo(width, centerY);
    ctx.stroke();

    // Draw light elegant semi-transparent masks over trimmed-out regions
    ctx.fillStyle = 'rgba(24, 24, 27, 0.04)';
    // Left mask
    if (xStart > 0) {
      ctx.fillRect(0, 0, xStart, height);
    }
    // Right mask
    if (xEnd < width) {
      ctx.fillRect(xEnd, 0, width - xEnd, height);
    }

    // Draw current playback playhead position vertical line
    if (playbackProgressRatio !== null && playbackProgressRatio >= 0 && playbackProgressRatio <= 1) {
      const playheadX = playbackProgressRatio * width;
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = '#3b82f6'; // Clean visual blue for playhead
      ctx.beginPath();
      ctx.moveTo(playheadX, 0);
      ctx.lineTo(playheadX, height);
      ctx.stroke();

      // Double-circle core indicator on central axis
      ctx.fillStyle = '#2563eb';
      ctx.beginPath();
      ctx.arc(playheadX, centerY, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    // Draw trim boundaries vertical bars (charcoal or elegant blue indicator on active/drag states)
    ctx.lineWidth = 2;
    const isStartActive = hoverState === 'start' || dragState === 'start';
    ctx.strokeStyle = isStartActive ? '#2563eb' : '#18181b';
    
    ctx.beginPath();
    ctx.moveTo(xStart, 0);
    ctx.lineTo(xStart, height);
    ctx.stroke();

    // End boundary
    const isEndActive = hoverState === 'end' || dragState === 'end';
    ctx.strokeStyle = isEndActive ? '#2563eb' : '#18181b';
    ctx.beginPath();
    ctx.moveTo(xEnd, 0);
    ctx.lineTo(xEnd, height);
    ctx.stroke();

    // Draw handle triangle badges on top
    ctx.fillStyle = isStartActive ? '#2563eb' : '#18181b';
    ctx.beginPath();
    ctx.moveTo(xStart - 6, 0);
    ctx.lineTo(xStart + 6, 0);
    ctx.lineTo(xStart, 8);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = isEndActive ? '#2563eb' : '#18181b';
    ctx.beginPath();
    ctx.moveTo(xEnd - 6, 0);
    ctx.lineTo(xEnd + 6, 0);
    ctx.lineTo(xEnd, 8);
    ctx.closePath();
    ctx.fill();

  }, [pcm, activeTrimStart, activeTrimEnd, ampScale, dragState, hoverState, playbackProgressRatio]);

  // Coordinate helper: translates client-X coordinates to 0..1 ratio
  const getRatioFromX = (clientX: number): number => {
    const canvas = canvasRef.current;
    if (!canvas) return 0;
    const rect = canvas.getBoundingClientRect();
    const relativeX = clientX - rect.left;
    return Math.max(0, Math.min(1, relativeX / rect.width));
  };

  // Drag listeners
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const ratio = getRatioFromX(e.clientX);
    const canvasWidth = canvasRef.current?.getBoundingClientRect().width || 1;

    // Get current pixel distances
    const startX = activeTrimStart * canvasWidth;
    const endX = activeTrimEnd * canvasWidth;
    const clickX = ratio * canvasWidth;

    const startDist = Math.abs(clickX - startX);
    const endDist = Math.abs(clickX - endX);

    // If within 18px of either handle, trigger drag
    if (startDist < 18 && startDist <= endDist) {
      setDragState('start');
    } else if (endDist < 18) {
      setDragState('end');
    } else {
      // If clicked somewhere, snap closest handle to that position
      if (clickX < startX + (endX - startX) / 2) {
        const val = Math.min(activeTrimEnd - 0.01, Math.max(0, ratio));
        onChangeTrim(val, activeTrimEnd);
        setDragState('start');
      } else {
        const val = Math.max(activeTrimStart + 0.01, Math.min(1, ratio));
        onChangeTrim(activeTrimStart, val);
        setDragState('end');
      }
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const ratio = getRatioFromX(e.clientX);
    
    // Manage dragging
    if (dragState === 'start') {
      const val = Math.min(activeTrimEnd - 0.01, Math.max(0, ratio));
      onChangeTrim(val, activeTrimEnd);
    } else if (dragState === 'end') {
      const val = Math.max(activeTrimStart + 0.01, Math.min(1, ratio));
      onChangeTrim(activeTrimStart, val);
    }

    // Manage visual hover effects
    const canvasWidth = canvasRef.current?.getBoundingClientRect().width || 1;
    const startX = activeTrimStart * canvasWidth;
    const endX = activeTrimEnd * canvasWidth;
    const hoverX = ratio * canvasWidth;

    const startDist = Math.abs(hoverX - startX);
    const endDist = Math.abs(hoverX - endX);

    if (startDist < 18 && startDist <= endDist) {
      setHoverState('start');
    } else if (endDist < 18) {
      setHoverState('end');
    } else {
      setHoverState('none');
    }
  };

  const handleMouseUpOrLeave = () => {
    setDragState('none');
  };

  // Mobile Touch events
  const handleTouchStart = (e: React.TouchEvent<HTMLCanvasElement>) => {
    if (e.touches.length === 0) return;
    const touch = e.touches[0];
    const ratio = getRatioFromX(touch.clientX);
    const canvasWidth = canvasRef.current?.getBoundingClientRect().width || 1;

    const startX = activeTrimStart * canvasWidth;
    const endX = activeTrimEnd * canvasWidth;
    const clickX = ratio * canvasWidth;

    const startDist = Math.abs(clickX - startX);
    const endDist = Math.abs(clickX - endX);

    if (startDist < 25 && startDist <= endDist) {
      setDragState('start');
    } else if (endDist < 25) {
      setDragState('end');
    }
  };

  const handleTouchMove = (e: React.TouchEvent<HTMLCanvasElement>) => {
    if (dragState === 'none' || e.touches.length === 0) return;
    const touch = e.touches[0];
    const ratio = getRatioFromX(touch.clientX);

    if (dragState === 'start') {
      const val = Math.min(activeTrimEnd - 0.01, Math.max(0, ratio));
      onChangeTrim(val, activeTrimEnd);
    } else if (dragState === 'end') {
      const val = Math.max(activeTrimStart + 0.01, Math.min(1, ratio));
      onChangeTrim(activeTrimStart, val);
    }
  };

  // Precise slider helpers
  const handleStartSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    const clampedStart = Math.min(activeTrimEnd - 0.01, val);
    onChangeTrim(clampedStart, activeTrimEnd);
  };

  const handleEndSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    const clampedEnd = Math.max(activeTrimStart + 0.01, val);
    onChangeTrim(activeTrimStart, clampedEnd);
  };

  const handleApplyCrop = () => {
    const startIndex = Math.floor(activeTrimStart * pcm.length);
    const endIndex = Math.floor(activeTrimEnd * pcm.length);
    const slicedSamples = pcm.slice(startIndex, endIndex);
    onTrimApply(slicedSamples, activeTrimStart, activeTrimEnd);
  };

  return (
    <div ref={containerRef} className="bg-white border border-zinc-200 rounded-2xl p-5 shadow-sm flex flex-col gap-4 animate-in fade-in slide-in-from-bottom duration-300">
      
      {/* Waveform Section Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-zinc-100 pb-3.5">
        <div className="flex items-center gap-3">
          <div>
            <h3 className="font-bold text-zinc-900 flex items-center gap-1.5 font-sans tracking-tight">
              Visual Waveform Studio
            </h3>
            <p className="text-xs text-zinc-500">
              Drag boundaries or sliders to crop and analyze selected audio regions.
            </p>
          </div>
        </div>
        
        {/* Timing parameters pill */}
        <div className="flex flex-wrap items-center gap-2 self-start sm:self-center">
          <div className="px-3 py-1 bg-zinc-50 rounded-lg flex items-center gap-1.5 text-xs text-zinc-650 border border-zinc-200/60 font-medium">
            <Clock className="w-3.5 h-3.5 text-zinc-450" />
            <span>Duration: <strong className="font-mono text-zinc-900 font-bold">{duration.toFixed(2)}s</strong></span>
          </div>
          <div className="px-3 py-1 bg-blue-50 rounded-lg flex items-center gap-1.5 text-xs text-blue-700 border border-blue-100 font-medium">
            <Volume2 className="w-3.5 h-3.5 text-blue-500" />
            <span>Trimmed: <strong className="font-mono font-bold">{trimmedDuration}s</strong></span>
          </div>
        </div>
      </div>

      {/* Waveform Canvas Arena */}
      <div className="relative group">
        <canvas
          ref={canvasRef}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUpOrLeave}
          onMouseLeave={handleMouseUpOrLeave}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleMouseUpOrLeave}
          className="w-full h-40 bg-zinc-50 rounded-xl border border-zinc-200 cursor-ew-resize transition-all group-hover:border-zinc-300"
          id={`waveform-canvas-${recordedAudio.id}`}
        />
        
        {/* Floating helper keys */}
        <div className="absolute top-2.5 right-2.5 flex items-center gap-1 text-[10px] text-zinc-500 bg-white/95 backdrop-blur-sm px-2.5 py-1 rounded-lg border border-zinc-200 shadow-sm">
          <span>Wave Amp Scale:</span>
          <button 
            type="button" 
            onClick={() => setAmpScale(prev => Math.max(0.3, prev - 0.2))}
            className="w-4 h-4 hover:bg-zinc-100 text-zinc-700 rounded font-bold transition-colors"
          >
            -
          </button>
          <span className="font-mono font-bold text-zinc-800">{ampScale.toFixed(1)}x</span>
          <button 
            type="button" 
            onClick={() => setAmpScale(prev => Math.min(5, prev + 0.2))}
            className="w-4 h-4 hover:bg-zinc-100 text-zinc-700 rounded font-bold transition-colors"
          >
            +
          </button>
        </div>
      </div>

      {/* precise trim sliders */}
      <div className="space-y-4 px-1">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          
          {/* Start Slider */}
          <div className="space-y-1.5">
            <div className="flex justify-between items-center text-xs">
              <span className="text-zinc-500 flex items-center gap-1">
                <ChevronLeft className="w-3.5 h-3.5 text-blue-600" /> 
                Start Position:
              </span>
              <span className="font-mono text-zinc-900 font-bold">
                {trimStartSec}s ({(activeTrimStart * 105).toFixed(0)}%)
              </span>
            </div>
            <input 
              type="range"
              step="0.005"
              min="0"
              max="1"
              value={activeTrimStart}
              onChange={handleStartSliderChange}
              className="w-full accent-zinc-900 bg-zinc-150 hover:bg-zinc-200 cursor-pointer h-1 rounded-lg appearance-none transition-colors border border-zinc-200"
            />
          </div>

          {/* End Slider */}
          <div className="space-y-1.5">
            <div className="flex justify-between items-center text-xs">
              <span className="text-zinc-500 flex items-center gap-1">
                End Position:
                <ChevronRight className="w-3.5 h-3.5 text-blue-600" />
              </span>
              <span className="font-mono text-zinc-900 font-bold">
                {trimEndSec}s ({(activeTrimEnd * 100).toFixed(0)}%)
              </span>
            </div>
            <input 
              type="range"
              step="0.005"
              min="0"
              max="1"
              value={activeTrimEnd}
              onChange={handleEndSliderChange}
              className="w-full accent-zinc-900 bg-zinc-150 hover:bg-zinc-200 cursor-pointer h-1 rounded-lg appearance-none transition-colors border border-zinc-200"
            />
          </div>

        </div>
      </div>

      {/* Editor controls */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-zinc-50 p-3 rounded-xl border border-zinc-200/80">
        
        {/* Slicing & preview buttons */}
        <div className="flex flex-wrap items-center gap-2">
          {isPlaying ? (
            <button
              id="stop-trim-prev-btn"
              type="button"
              onClick={onStopTrimmed}
              className="flex items-center gap-1.5 px-4 py-2 bg-red-600 hover:bg-red-500 text-white rounded-lg text-xs font-semibold cursor-pointer transition-all shadow-sm active:scale-95"
            >
              <Square className="w-3.5 h-3.5" /> Stop Preview
            </button>
          ) : (
            <button
              id="play-trim-prev-btn"
              type="button"
              onClick={onPlayTrimmed}
              className="flex items-center gap-1.5 px-4 py-2 bg-zinc-900 hover:bg-zinc-800 text-white rounded-lg text-xs font-semibold cursor-pointer transition-all shadow-sm active:scale-95"
            >
              <Play className="w-3.5 h-3.5" /> Play Selected
            </button>
          )}

          <button
            id="apply-crop-btn"
            type="button"
            onClick={handleApplyCrop}
            className="flex items-center gap-1.5 px-4 py-2 bg-white hover:bg-zinc-50 text-zinc-800 hover:text-zinc-950 rounded-lg text-xs font-semibold cursor-pointer transition-all active:scale-95 border border-zinc-250 shadow-sm"
            title="Crop only the highlighted region, setting as the core source"
          >
            <Scissors className="w-3.5 h-3.5 text-zinc-700" /> Apply Crop
          </button>

          <button
            id="reset-crop-btn"
            type="button"
            onClick={onTrimReset}
            className="flex items-center gap-1.5 px-3 py-2 text-zinc-500 hover:text-zinc-800 hover:bg-zinc-100 rounded-lg text-xs font-semibold cursor-pointer transition-all active:scale-95"
          >
            <RotateCcw className="w-3.5 h-3.5" /> Reset Selection
          </button>
        </div>

        {/* Dynamic downloadable outputs */}
        <div className="flex items-center gap-2">
          {downloadUrl && (
            <a
              id="download-trimmed-link"
              href={downloadUrl}
              download={`${recordedAudio.id}_trimmed.wav`}
              className="flex items-center gap-1 px-3.5 py-2 bg-blue-50 hover:bg-blue-105 text-blue-650 rounded-lg text-xs font-semibold border border-blue-150 transition-colors cursor-pointer"
              title="Save only the selected region as a WAV file"
            >
              <Download className="w-3.5 h-3.5" /> Trimmed WAV
            </a>
          )}
          
          {fullDownloadUrl && (
            <a
              id="download-full-link"
              href={fullDownloadUrl}
              download={`${recordedAudio.id}_full.wav`}
              className="flex items-center gap-1 px-3.5 py-2 bg-zinc-100 hover:bg-zinc-150 text-zinc-700 rounded-lg text-xs font-semibold border border-zinc-200 transition-colors cursor-pointer"
              title="Save the complete unedited raw recording as a WAV file"
            >
              <Download className="w-3.5 h-3.5 text-zinc-500" /> Full WAV
            </a>
          )}
        </div>

      </div>

    </div>
  );
}
