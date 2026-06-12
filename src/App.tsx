/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  Activity, 
  Mic, 
  FileAudio, 
  Play, 
  Pause, 
  Square,
  RefreshCw, 
  Copy, 
  FileCheck, 
  ChevronRight, 
  ChevronLeft,
  ChevronUp,
  ChevronDown,
  ZoomIn,
  ZoomOut,
  Sliders, 
  Scale, 
  Bookmark,
  Layers,
  Volume2,
  Trash2,
  Dna,
  Check
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  MaterialProperties, 
  CustomMarkers, 
  AudioSourceType,
  RecordedAudio 
} from './types';
import { createWavBlobUrl } from './utils/wav';
import WaveformTrimmer from './components/WaveformTrimmer';

export default function App() {
  // --- STATE DECLARATIONS ---
  const [audioSource, setAudioSource] = useState<AudioSourceType>('mic');
  const [fftSize, setFftSize] = useState<number>(2048);
  const [sampleRateOption, setSampleRateOption] = useState<string>('default');
  const [actualSampleRate, setActualSampleRate] = useState<number | null>(null);
  
  // Custom bounding frequencies for visual grid limits (in Hz)
  const [minFreqInput, setMinFreqInput] = useState<string>('0');
  const [maxFreqInput, setMaxFreqInput] = useState<string>('20000');
  const [minFreq, setMinFreq] = useState<number>(0);
  const [maxFreq, setMaxFreq] = useState<number>(20000);

  // Dynamic dB bounds for vertical zoom & scale
  const [minDb, setMinDb] = useState<number>(-120);
  const [maxDb, setMaxDb] = useState<number>(-10);

  // Material properties (mm / kg)
  const [material, setMaterial] = useState<MaterialProperties>({
    width: 50,
    thickness: 15,
    length: 400,
    mass: 0.2
  });

  // Custom density override states
  const [overrideDensityInput, setOverrideDensityInput] = useState<string>('');
  const [useOverrideDensity, setUseOverrideDensity] = useState<boolean>(false);

  // Highlight anchors/markers parameter-based (E & G)
  const [markerE, setMarkerE] = useState<string>('200');
  const [markerG, setMarkerG] = useState<string>('1');

  // Microphone recording configs
  const [micPrefix, setMicPrefix] = useState<string>('mic_record');
  const [micDevices, setMicDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedMicId, setSelectedMicId] = useState<string>('');
  const [micMonitor, setMicMonitor] = useState<boolean>(false);

  // Recording status descriptors
  const [isRecording, setIsRecording] = useState<boolean>(false);
  const [recordingDuration, setRecordingDuration] = useState<number>(0);
  const [recordedAudio, setRecordedAudio] = useState<RecordedAudio | null>(null);

  // Maintain first copy of full recorded PCM for "Reset Crop/Trim"
  const [originalPcm, setOriginalPcm] = useState<Float32Array | null>(null);
  const [originalDuration, setOriginalDuration] = useState<number>(0);

  // Trimming visual cursor boundaries (0 to 1 ratios)
  const [activeTrimStart, setActiveTrimStart] = useState<number>(0);
  const [activeTrimEnd, setActiveTrimEnd] = useState<number>(1);
  const [isPlayingTrimmed, setIsPlayingTrimmed] = useState<boolean>(false);
  const [playbackProgressRatio, setPlaybackProgressRatio] = useState<number | null>(null);

  // Playback tracking refs
  const playbackStartTimeRef = useRef<number>(0);
  const playbackDurationRef = useRef<number>(0);

  // Metrics trackers (State throttled to ~10 FPS for lightning fast rendering without React overhead)
  const [livePeakFreq, setLivePeakFreq] = useState<number | null>(null);
  const [livePeakAmp, setLivePeakAmp] = useState<number | null>(null);
  const [maxHoldPeakFreq, setMaxHoldPeakFreq] = useState<number | null>(null);
  const [isCopied, setIsCopied] = useState<boolean>(false);

  // Active pipelines
  const [isPipelineActive, setIsPipelineActive] = useState<boolean>(false);

  // File loading reference
  const [selectedFileName, setSelectedFileName] = useState<string>('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isVideoFile, setIsVideoFile] = useState<boolean>(false);
  const [isImporting, setIsImporting] = useState<boolean>(false);
  const [importError, setImportError] = useState<string>('');

  // --- MUTABLE REAL-TIME REFS (For Animation loop) ---
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceNodeRef = useRef<AudioNode | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  
  // Real-time canvas cache
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const maxHoldDataRef = useRef<Float32Array | null>(null);
  const lastStateUpdateRef = useRef<number>(0);
  
  // Recording capture nodes
  const recorderNodeRef = useRef<ScriptProcessorNode | null>(null);
  const recordedChunksRef = useRef<Float32Array[]>([]);
  const recordedLengthRef = useRef<number>(0);
  const recordIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Loop/Playback outputs
  const playbackSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const fileElementRef = useRef<HTMLVideoElement | null>(null);

  // Simulated tap engine timeout
  const originalPcmRef = useRef<Float32Array | null>(null);

  // Enumerate Mic sources
  const updateMicDevicesList = useCallback(async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const mics = devices.filter(d => d.kind === 'audioinput');
      setMicDevices(mics);
    } catch (e) {
      console.warn("Could not retrieve standard microphonic devices:", e);
    }
  }, []);

  // Request/Update permissions lists on load
  useEffect(() => {
    updateMicDevicesList();
    // Re-check devices occasionally if hardware shifts
    if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
      navigator.mediaDevices.addEventListener('devicechange', updateMicDevicesList);
      return () => {
        navigator.mediaDevices.removeEventListener('devicechange', updateMicDevicesList);
      };
    }
  }, [updateMicDevicesList]);

  // Clean raw buffers on unmount
  useEffect(() => {
    return () => {
      if (audioCtxRef.current) {
        audioCtxRef.current.close().catch(() => {});
      }
      if (micStreamRef.current) {
        micStreamRef.current.getTracks().forEach(track => track.stop());
      }
      if (recordIntervalRef.current) {
        clearInterval(recordIntervalRef.current);
      }
    };
  }, []);

  // Sync state frequency parameters with viewport scale
  useEffect(() => {
    const minVal = parseFloat(minFreqInput) || 0;
    const maxVal = parseFloat(maxFreqInput) || 20000;
    setMinFreq(Math.max(0, minVal));
    setMaxFreq(Math.max(minVal + 10, maxVal));
  }, [minFreqInput, maxFreqInput]);

  // --- AUDIO PIPELINE ACTIVATION ENGINE ---
  const stopExistingPipeline = () => {
    // Stop recording if active
    if (isRecording) {
      stopRecording();
    }
    
    // Stop any custom playbacks
    stopTrimmedPlayback();

    // Close any previous stream tracks
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach(track => track.stop());
      micStreamRef.current = null;
    }

    // Disconnect file audio if active
    if (sourceNodeRef.current) {
      try {
        sourceNodeRef.current.disconnect();
      } catch (e) {}
    }

    // Stop and compile script processors
    if (recorderNodeRef.current) {
      try {
        recorderNodeRef.current.disconnect();
      } catch (e) {}
      recorderNodeRef.current = null;
    }

    setIsPipelineActive(false);
  };

  const handleStartPipeline = async () => {
    stopExistingPipeline();

    // Trigger state context activation (to prevent autoplay policies)
    const ContextClass = (window.AudioContext || (window as any).webkitAudioContext);
    const options: AudioContextOptions = {};
    if (sampleRateOption !== 'default') {
      options.sampleRate = parseInt(sampleRateOption);
    }

    let actx: AudioContext;
    try {
      actx = new ContextClass(options);
    } catch (e) {
      console.warn("Requested sample rate not fully supported by device. Falling back.", e);
      actx = new ContextClass();
    }

    if (actx.state === 'suspended') {
      await actx.resume();
    }

    audioCtxRef.current = actx;
    setActualSampleRate(actx.sampleRate);

    // Build Analyser Node
    const analyser = actx.createAnalyser();
    analyser.fftSize = fftSize;
    analyser.smoothingTimeConstant = 0.75;
    analyserRef.current = analyser;

    // Reset max hold
    maxHoldDataRef.current = new Float32Array(analyser.frequencyBinCount).fill(-Infinity);

    if (audioSource === 'mic') {
      try {
        const constraints: MediaStreamConstraints = {
          audio: selectedMicId ? { deviceId: { exact: selectedMicId } } : true
        };
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        micStreamRef.current = stream;

        const micSource = actx.createMediaStreamSource(stream);
        micSource.connect(analyser);
        sourceNodeRef.current = micSource;

        // Monitor callback setup
        if (micMonitor) {
          analyser.connect(actx.destination);
        }

        // Refresh friendly labels since perm granted
        updateMicDevicesList();
        setIsPipelineActive(true);

      } catch (err: any) {
        alert("Microphone capture failed. Verify security permissions in your browser.\nError: " + err.message);
        return;
      }
    } else {
      // File mode
      const playerEle = fileElementRef.current;
      if (!playerEle || !playerEle.src) {
        alert("Please load an audio file first using the picker.");
        return;
      }
      
      try {
        const fileSource = actx.createMediaElementSource(playerEle);
        fileSource.connect(analyser);
        analyser.connect(actx.destination);
        sourceNodeRef.current = fileSource;
        setIsPipelineActive(true);
        playerEle.play().catch(e => console.log("Auto-play initiated", e));
      } catch (err) {
        console.warn("Media element attachment error. Refreshing player element.", err);
      }
    }
  };

  // Switch mic monitor dynamic route
  useEffect(() => {
    const analyser = analyserRef.current;
    const actx = audioCtxRef.current;
    if (analyser && actx && audioSource === 'mic') {
      try {
        if (micMonitor) {
          analyser.connect(actx.destination);
        } else {
          analyser.disconnect(actx.destination);
        }
      } catch (e) {}
    }
  }, [micMonitor, audioSource]);

  // Adjust live FFT sizes on change
  useEffect(() => {
    const analyser = analyserRef.current;
    if (analyser) {
      analyser.fftSize = fftSize;
      maxHoldDataRef.current = new Float32Array(analyser.frequencyBinCount).fill(-Infinity);
    }
  }, [fftSize]);

  // --- RECORDING MACHINERY (ScriptProcessor-based Mono WAV) ---
  const startRecording = () => {
    const actx = audioCtxRef.current;
    const analyser = analyserRef.current;
    const sourceNode = sourceNodeRef.current;

    if (!actx || !analyser || !sourceNode || audioSource !== 'mic') {
      alert("Please ensure the microphone pipeline is active first via 'Apply Connection'.");
      return;
    }

    recordedChunksRef.current = [];
    recordedLengthRef.current = 0;
    setRecordingDuration(0);
    setIsRecording(true);

    // Create processor node (mono canvas capture)
    const proc = actx.createScriptProcessor(4096, 1, 1);
    proc.onaudioprocess = (e) => {
      const input = e.inputBuffer.getChannelData(0);
      // Clone buffer to prevent browser recycle data loss
      recordedChunksRef.current.push(new Float32Array(input));
      recordedLengthRef.current += input.length;
    };

    // Fasten components
    sourceNode.connect(proc);
    
    // Connect to un-activated gain block to trigger process loops
    const dummyGain = actx.createGain();
    dummyGain.gain.value = 0;
    proc.connect(dummyGain);
    dummyGain.connect(actx.destination);

    recorderNodeRef.current = proc;

    // Tick clock
    let sec = 0;
    recordIntervalRef.current = setInterval(() => {
      sec += 0.5;
      setRecordingDuration(sec);
    }, 500);
  };

  const stopRecording = () => {
    if (!isRecording) return;
    setIsRecording(false);

    if (recordIntervalRef.current) {
      clearInterval(recordIntervalRef.current);
      recordIntervalRef.current = null;
    }

    const proc = recorderNodeRef.current;
    if (proc) {
      proc.disconnect();
      recorderNodeRef.current = null;
    }

    // Merge buffers
    const totalLen = recordedLengthRef.current;
    const buffers = recordedChunksRef.current;
    const merged = new Float32Array(totalLen);
    let offset = 0;
    for (const b of buffers) {
      merged.set(b, offset);
      offset += b.length;
    }

    if (totalLen > 0) {
      const rate = actualSampleRate || 44100;
      const durSec = totalLen / rate;
      const bUrl = createWavBlobUrl(merged, rate);

      const audRec: RecordedAudio = {
        id: `${micPrefix}_${Date.now()}`,
        pcmData: merged,
        sampleRate: rate,
        duration: durSec,
        blobUrl: bUrl
      };

      setRecordedAudio(audRec);
      setOriginalPcm(merged);
      originalPcmRef.current = merged;
      setOriginalDuration(durSec);
      
      // Reset trim boundaries
      setActiveTrimStart(0);
      setActiveTrimEnd(1);
    }
  };

  const handleTestRecordingDelete = () => {
    stopTrimmedPlayback();
    if (recordedAudio) {
      URL.revokeObjectURL(recordedAudio.blobUrl);
    }
    setRecordedAudio(null);
    setOriginalPcm(null);
    originalPcmRef.current = null;
    setOriginalDuration(0);
  };

  // --- AUDIO TRIMMING & LOOP BACK PREVIEWS ---
  const handleTrimUpdate = (startRatio: number, endRatio: number) => {
    setActiveTrimStart(startRatio);
    setActiveTrimEnd(endRatio);
  };

  const applyCropToActive = (slicedPcm: Float32Array, startRatio: number, endRatio: number) => {
    if (!recordedAudio) return;

    // Create new cropped audio record
    const rate = recordedAudio.sampleRate;
    const durSec = slicedPcm.length / rate;
    const newBlobUrl = createWavBlobUrl(slicedPcm, rate);

    const cropped: RecordedAudio = {
      ...recordedAudio,
      pcmData: slicedPcm,
      duration: durSec,
      blobUrl: newBlobUrl
    };

    // Revoke old URL to avoid leaks
    URL.revokeObjectURL(recordedAudio.blobUrl);
    
    setRecordedAudio(cropped);
    
    // Reset range selectors since we cropped the workspace down to this slice
    setActiveTrimStart(0);
    setActiveTrimEnd(1);
  };

  const handleResetCropToOriginal = () => {
    if (!originalPcm || !recordedAudio) return;

    const rate = recordedAudio.sampleRate;
    const newBlobUrl = createWavBlobUrl(originalPcm, rate);

    const restored: RecordedAudio = {
      id: recordedAudio.id,
      pcmData: originalPcm,
      sampleRate: rate,
      duration: originalDuration,
      blobUrl: newBlobUrl
    };

    URL.revokeObjectURL(recordedAudio.blobUrl);
    setRecordedAudio(restored);
    setActiveTrimStart(0);
    setActiveTrimEnd(1);
  };

  // Sound playbacks for previews
  const playTrimmedPlaybackSpan = () => {
    if (!recordedAudio || !audioCtxRef.current || !analyserRef.current) {
      alert("Ensure context and recorded sound exists before playback.");
      return;
    }

    stopTrimmedPlayback();

    const actx = audioCtxRef.current;
    const analyser = analyserRef.current;
    const corePcm = recordedAudio.pcmData;

    // Crop samples relative to start / end ratios
    const startIdx = Math.floor(activeTrimStart * corePcm.length);
    const endIdx = Math.max(startIdx + 10, Math.floor(activeTrimEnd * corePcm.length));
    const playableSlice = corePcm.slice(startIdx, endIdx);

    const audioBuffer = actx.createBuffer(1, playableSlice.length, recordedAudio.sampleRate);
    audioBuffer.copyToChannel(playableSlice, 0);

    const bufferSource = actx.createBufferSource();
    bufferSource.buffer = audioBuffer;
    bufferSource.loop = true; // Loop so users can analyze the spectrum continuously

    // Pipe outputs through FFT Analyser so it is visualised!
    bufferSource.connect(analyser);
    analyser.connect(actx.destination);

    const sliceDuration = playableSlice.length / recordedAudio.sampleRate;
    playbackDurationRef.current = sliceDuration;
    playbackStartTimeRef.current = actx.currentTime;

    bufferSource.start(0);
    playbackSourceRef.current = bufferSource;
    setIsPlayingTrimmed(true);
  };

  const stopTrimmedPlayback = () => {
    const playSrc = playbackSourceRef.current;
    if (playSrc) {
      try {
        playSrc.stop();
      } catch (e) {}
      playSrc.disconnect();
      playbackSourceRef.current = null;
    }
    setIsPlayingTrimmed(false);
    setPlaybackProgressRatio(null);
  };

  // Monitor loop playback progress 60 times a second to track the visual playhead
  useEffect(() => {
    if (!isPlayingTrimmed || !audioCtxRef.current) {
      setPlaybackProgressRatio(null);
      return;
    }

    let animId: number;
    const updateProgress = () => {
      if (!audioCtxRef.current || !isPlayingTrimmed) {
        setPlaybackProgressRatio(null);
        return;
      }
      const actx = audioCtxRef.current;
      const duration = playbackDurationRef.current;
      const startTime = playbackStartTimeRef.current;
      if (duration > 0 && startTime > 0) {
        const elapsed = actx.currentTime - startTime;
        const progressInSlice = (elapsed % duration) / duration;
        // Map from local slice progress (0..1) to global waveform progress (activeTrimStart..activeTrimEnd)
        const absoluteRatio = activeTrimStart + progressInSlice * (activeTrimEnd - activeTrimStart);
        setPlaybackProgressRatio(absoluteRatio);
      }
      animId = requestAnimationFrame(updateProgress);
    };

    animId = requestAnimationFrame(updateProgress);
    return () => cancelAnimationFrame(animId);
  }, [isPlayingTrimmed, activeTrimStart, activeTrimEnd]);


  // --- DYNAMIC RENDERING LOOP (60 FPS on Custom Canvas) ---
  const runDrawVisualizerFrame = useCallback(() => {
    if (!analyserRef.current || !audioCtxRef.current || !canvasRef.current) {
      requestAnimationFrame(runDrawVisualizerFrame);
      return;
    }

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      requestAnimationFrame(runDrawVisualizerFrame);
      return;
    }

    const analyser = analyserRef.current;
    const actx = audioCtxRef.current;
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Float32Array(bufferLength);
    analyser.getFloatFrequencyData(dataArray);

    // Sync Max Hold buffers
    if (!maxHoldDataRef.current || maxHoldDataRef.current.length !== bufferLength) {
      maxHoldDataRef.current = new Float32Array(bufferLength).fill(-Infinity);
    }
    const maxHoldData = maxHoldDataRef.current;

    // Search peaks
    let liveMaxVal = -Infinity;
    let livePeakIdx = -1;
    let maxHoldMaxVal = -Infinity;
    let maxHoldPeakIdx = -1;

    for (let i = 0; i < bufferLength; i++) {
      const val = dataArray[i];
      if (val > maxHoldData[i]) {
        maxHoldData[i] = val;
      }
      if (val > liveMaxVal) {
        liveMaxVal = val;
        livePeakIdx = i;
      }
      if (maxHoldData[i] > maxHoldMaxVal) {
        maxHoldMaxVal = maxHoldData[i];
        maxHoldPeakIdx = i;
      }
    }

    // Convert peaks index to Hz frequencies
    const binSizeHz = actx.sampleRate / analyser.fftSize;
    const curLivePeakHz = livePeakIdx !== -1 && liveMaxVal > -Infinity ? livePeakIdx * binSizeHz : 0;
    const curMaxHoldPeakHz = maxHoldPeakIdx !== -1 && maxHoldMaxVal > -Infinity ? maxHoldPeakIdx * binSizeHz : 0;

    // Convert max linear scale levels
    const liveLinearAmp = Math.pow(10, liveMaxVal / 20);

    // Throttle React state updates to avoid component stuttering
    const now = performance.now();
    if (now - lastStateUpdateRef.current > 120) {
      setLivePeakFreq(curLivePeakHz > 0 ? curLivePeakHz : null);
      setLivePeakAmp(liveMaxVal > -Infinity ? liveLinearAmp : 0);
      setMaxHoldPeakFreq(curMaxHoldPeakHz > 0 ? curMaxHoldPeakHz : null);
      lastStateUpdateRef.current = now;
    }

    // --- CANVAS DRAW CODES ---
    const width = canvas.width;
    const height = canvas.height;

    // Background pristine white/light grey
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);

    // Draw dynamic background reference grids
    ctx.strokeStyle = 'rgba(24, 24, 27, 0.05)'; // Zinc 900 5% opacity
    ctx.lineWidth = 1;
    ctx.font = '11px "JetBrains Mono", monospace';
    ctx.fillStyle = 'rgba(24, 24, 27, 0.45)'; // Zinc 900 45% opacity

    const gridLines = 8;
    for (let j = 0; j <= gridLines; j++) {
      const ratio = j / gridLines;
      const hzVal = minFreq + ratio * (maxFreq - minFreq);
      const x = ratio * width;

      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();

      const label = hzVal >= 1000 ? `${(hzVal / 1000).toFixed(2)} kHz` : `${hzVal.toFixed(0)} Hz`;
      ctx.fillText(label, x + 5, height - 8);
    }

    // Draw horizontal amplitude decibel decors dynamically based on current zoom
    const dbSpan = maxDb - minDb;
    let step = 20;
    if (dbSpan < 35) step = 5;
    else if (dbSpan < 70) step = 10;
    
    const dbSteps: number[] = [];
    const firstStep = Math.ceil((minDb + 1) / step) * step;
    for (let db = firstStep; db < maxDb; db += step) {
      dbSteps.push(db);
    }

    ctx.font = '8px "JetBrains Mono", monospace';
    ctx.fillStyle = 'rgba(24, 24, 27, 0.35)';
    dbSteps.forEach(db => {
      const percent = (db - minDb) / (maxDb - minDb);
      const y = height - percent * height;
      
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.strokeStyle = 'rgba(24, 24, 27, 0.04)';
      ctx.stroke();
      ctx.fillText(`${db} dB`, 6, y - 4);
    });

    const getCanvasY = (val: number): number => {
      if (val === -Infinity || val < minDb) return height;
      if (val > maxDb) return 0;
      const p = (val - minDb) / (maxDb - minDb);
      return height - p * height;
    };

    const getBinIndexForFreq = (f: number): number => {
      const binIndex = Math.round(f * analyser.fftSize / actx.sampleRate);
      return Math.min(bufferLength - 1, Math.max(0, binIndex));
    };

    // --- DRAW LIVE FFT SPECTROGRAM ---
    ctx.beginPath();
    ctx.moveTo(0, height);
    for (let x = 0; x < width; x++) {
      const percent = x / width;
      const f = minFreq + percent * (maxFreq - minFreq);
      const bin = getBinIndexForFreq(f);
      const db = dataArray[bin];
      const y = getCanvasY(db);

      if (x === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.lineTo(width, height);
    ctx.lineTo(0, height);
    ctx.closePath();
    
    // Elegant soft digital blue fill
    const fillGrad = ctx.createLinearGradient(0, 0, 0, height);
    fillGrad.addColorStop(0, 'rgba(37, 99, 235, 0.12)');
    fillGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = fillGrad;
    ctx.fill();

    // Wave boundary stroke outline
    ctx.strokeStyle = '#2563eb';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let x = 0; x < width; x++) {
      const percent = x / width;
      const f = minFreq + percent * (maxFreq - minFreq);
      const bin = getBinIndexForFreq(f);
      const db = dataArray[bin];
      const y = getCanvasY(db);

      if (x === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();

    // --- DRAW MAX HOLD SPECTRUM (PINK WAVE) ---
    ctx.beginPath();
    for (let x = 0; x < width; x++) {
      const percent = x / width;
      const f = minFreq + percent * (maxFreq - minFreq);
      const bin = getBinIndexForFreq(f);
      const db = maxHoldData[bin];
      const y = getCanvasY(db);

      if (x === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.strokeStyle = '#f43f5e'; // Soft pink/rose for Max Hold Line
    ctx.lineWidth = 1;
    ctx.stroke();

    // --- RENDER CUSTOM MARKER ANCHORS (A, B, C, D) ---
    const drawCustomMarkerLine = (val: number, label: string, color: string, verticalTextOffset: number) => {
      if (isNaN(val) || val < minFreq || val > maxFreq) return;
      const p = (val - minFreq) / (maxFreq - minFreq);
      const x = p * width;

      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 4]);
      
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
      ctx.setLineDash([]); // Reset

      ctx.fillStyle = color;
      ctx.font = 'bold 9px "JetBrains Mono", monospace';
      const labelText = `${label}: ${val >= 1000 ? (val / 1000).toFixed(3) + ' kHz' : val.toFixed(0) + ' Hz'}`;
      const textWidth = ctx.measureText(labelText).width;
      
      const labelX = (x + textWidth + 12 > width) ? (x - textWidth - 8) : (x + 6);
      ctx.fillText(labelText, labelX, verticalTextOffset);
    };

    const valE = parseFloat(markerE);
    const valG = parseFloat(markerG);

    if (!isNaN(valE) && !isNaN(valG) && valE > 0 && valG > 0) {
      const base = valE * valG;
      const colors = [
        '#0284c7', // light blue
        '#0369a1',
        '#0f766e', // teal
        '#4f46e5', // indigo
        '#7c3aed', // purple
        '#6d28d9', 
        '#ca8a04', // amber yellow
        '#b45309',
        '#db2777', // rose pink
        '#be185d',
        '#dc2626', // crimson red
        '#b91c1c'
      ];
      for (let i = 1; i <= 12; i++) {
        const val = i * base;
        const color = colors[(i - 1) % colors.length];
        const offset = 60 + ((i - 1) % 6) * 16; // staggers vertical offset from 60 to 140
        drawCustomMarkerLine(val, `${i}*E*G`, color, offset);
      }
    }

    // --- DRAW LIVE PEAK VERTICAL METRIC ---
    if (curLivePeakHz >= minFreq && curLivePeakHz <= maxFreq) {
      const p = (curLivePeakHz - minFreq) / (maxFreq - minFreq);
      const x = p * width;

      ctx.strokeStyle = '#ca8a04'; // Muted dark yellow for readability
      ctx.lineWidth = 1.2;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = '#ca8a04';
      ctx.font = 'bold 10px "JetBrains Mono", monospace';
      const text = `Live Peak: ${(curLivePeakHz / 1000).toFixed(3)} kHz`;
      const textWidth = ctx.measureText(text).width;
      const labelX = (x + textWidth + 12 > width) ? (x - textWidth - 8) : (x + 6);
      ctx.fillText(text, labelX, 20);
    }

    // --- DRAW MAX HOLD PEAK VERTICAL ---
    if (curMaxHoldPeakHz >= minFreq && curMaxHoldPeakHz <= maxFreq) {
      const p = (curMaxHoldPeakHz - minFreq) / (maxFreq - minFreq);
      const x = p * width;

      ctx.strokeStyle = '#dc2626'; // Deep red indicator for maximum hold readability
      ctx.lineWidth = 1.2;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = '#dc2626';
      ctx.font = 'bold 10px "JetBrains Mono", monospace';
      const text = `Max Hold Peak: ${(curMaxHoldPeakHz / 1000).toFixed(3)} kHz`;
      const textWidth = ctx.measureText(text).width;
      const labelX = (x + textWidth + 12 > width) ? (x - textWidth - 8) : (x + 6);
      ctx.fillText(text, labelX, 38);
    }

    requestAnimationFrame(runDrawVisualizerFrame);
  }, [minFreq, maxFreq, markerE, markerG, minDb, maxDb]);

  // Activate dynamic canvas painters on mount/render changes
  useEffect(() => {
    runDrawVisualizerFrame();
  }, [runDrawVisualizerFrame]);

  // Reset max hold elements
  const handleResetMaxHold = () => {
    if (maxHoldDataRef.current) {
      maxHoldDataRef.current.fill(-Infinity);
    }
    setMaxHoldPeakFreq(null);
  };

  // --- DENSITY CALCULATOR (at all times) ---
  const calculatedDensity = (() => {
    const { width, thickness, length, mass } = material;
    if (width <= 0 || thickness <= 0 || length <= 0 || mass <= 0) {
      return null;
    }
    const volume = (width * thickness * length) / 1e9;
    return mass / volume;
  })();

  const parsedOverrideDensity = parseFloat(overrideDensityInput);
  const activeDensity = (useOverrideDensity && !isNaN(parsedOverrideDensity) && parsedOverrideDensity > 0)
    ? parsedOverrideDensity
    : calculatedDensity;

  // --- MATERIAL EQUATION FORMULATOR COMPUTERS ---
  const calculateModulusAndDensityValues = (freq: number | null) => {
    const { length } = material;
    const density = activeDensity;
    
    if (!freq || freq <= 0 || !density || density <= 0) {
      return { density, modulusUser: null, modulusPhys: null };
    }

    // 1. Literal standard user E: E = density * f^2 * 4 
    // Translated from Pa -> N/mm^2 (MPa) dividing by 1,000,000
    const modulusUser = (density * freq * freq * 4) / 1e6;

    // 2. Physical Euler-Bernoulli/standard calculation: E = 4 * L^2 * f^2 * density
    const L_meters = length / 1000;
    const modulusPhys = (4 * L_meters * L_meters * freq * freq * density) / 1e6;

    return { density, modulusUser, modulusPhys };
  };

  const liveCalculated = calculateModulusAndDensityValues(livePeakFreq);
  const maxCalculated = calculateModulusAndDensityValues(maxHoldPeakFreq);

  // Clipboard operations
  const copyFormattedMaterialData = () => {
    const { width, thickness, length, mass } = material;
    const id = micPrefix.trim() || 'record';
    
    const densityVal = calculatedDensity ? calculatedDensity.toFixed(1) : '--';
    const activeDensityVal = activeDensity ? activeDensity.toFixed(1) : '--';
    const overrideStatus = useOverrideDensity ? `(User Override Active: ${activeDensityVal} kg/m³)` : '(Using Calculated)';
    
    const liveModU = liveCalculated.modulusUser ? `${liveCalculated.modulusUser.toFixed(2)} N/mm²` : '--';
    const liveModP = liveCalculated.modulusPhys ? `${liveCalculated.modulusPhys.toFixed(2)} N/mm²` : '--';
    const maxModU = maxCalculated.modulusUser ? `${maxCalculated.modulusUser.toFixed(2)} N/mm²` : '--';
    const maxModP = maxCalculated.modulusPhys ? `${maxCalculated.modulusPhys.toFixed(2)} N/mm²` : '--';

    const text = `Acoustic Modulus Report
-------------------------
Specimen Reference ID: ${id}
Dimensions: ${width}mm x ${thickness}mm x ${length}mm
Specimen Mass: ${mass} kg
Calculated Density: ${densityVal} kg/m³
Active Density Used: ${activeDensityVal} kg/m³ ${overrideStatus}
Captured Live Resonance Peak: ${livePeakFreq ? livePeakFreq.toFixed(1) + ' Hz' : '--'}
Captured Max Hold Resonance Peak: ${maxHoldPeakFreq ? maxHoldPeakFreq.toFixed(1) + ' Hz' : '--'}

Elastic Young's Modulus (E):
- Live (User Schema Formula): ${liveModU}
- Live (Euler Physical Standard): ${liveModP}
- Max Hold Peak (User Schema Formula): ${maxModU}
- Max Hold Peak (Euler Physical Standard): ${maxModP}
`;

    navigator.clipboard.writeText(text).then(() => {
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    }).catch(err => {
      alert("Clipboard copy failed. Please grant permission.");
    });
  };

  // --- AUDIO/VIDEO FILE SELECTION HANDLER ---
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      setSelectedFileName(file.name);
      setImportError('');
      const url = URL.createObjectURL(file);
      const isVideo = file.type.startsWith('video/') || file.name.match(/\.(mp4|webm|ogg|mov|mkv|avi)$/i) !== null;
      setIsVideoFile(isVideo);
      
      const audEle = fileElementRef.current;
      if (audEle) {
        audEle.src = url;
        audEle.load();
      }

      // Automatically set audio source to file mode and trigger start button help notice
      setAudioSource('file');
      stopExistingPipeline();
    }
  };

  const copyMediaAudioToStudio = async () => {
    if (!selectedFile) return;
    setIsImporting(true);
    setImportError('');
    
    try {
      const arrayBuffer = await selectedFile.arrayBuffer();
      const ContextClass = (window.AudioContext || (window as any).webkitAudioContext);
      let actx = audioCtxRef.current;
      if (!actx) {
        actx = new ContextClass();
        audioCtxRef.current = actx;
        setActualSampleRate(actx.sampleRate);
      }
      
      // Setup helper nodes if not existing
      if (!analyserRef.current) {
        const analyser = actx.createAnalyser();
        analyser.fftSize = fftSize;
        analyserRef.current = analyser;
        maxHoldDataRef.current = new Float32Array(analyser.frequencyBinCount).fill(-Infinity);
      }

      // Decode audio data
      const audioBuffer = await actx.decodeAudioData(arrayBuffer);
      const pcm = audioBuffer.getChannelData(0); // single channel
      const rate = audioBuffer.sampleRate;
      const duration = audioBuffer.duration;
      
      // Stop prior playback
      stopTrimmedPlayback();

      const bUrl = createWavBlobUrl(pcm, rate);
      const importedAudio: RecordedAudio = {
        id: `imported_${Date.now()}`,
        pcmData: pcm,
        sampleRate: rate,
        duration: duration,
        blobUrl: bUrl
      };

      setRecordedAudio(importedAudio);
      setOriginalPcm(pcm);
      originalPcmRef.current = pcm;
      setOriginalDuration(duration);

      // Reset selection positions
      setActiveTrimStart(0);
      setActiveTrimEnd(1);

      // Reset peak trackers
      if (maxHoldDataRef.current) {
        maxHoldDataRef.current.fill(-Infinity);
      }
      setLivePeakFreq(null);
      setMaxHoldPeakFreq(null);

    } catch (err: any) {
      console.error(err);
      setImportError(err.message || 'Failed to extract audio from this media file. Check format support.');
    } finally {
      setIsImporting(false);
    }
  };

  // --- HORIZONTAL SPECTRUM ZOOM & PAN HANDLERS ---
  const handleHzZoomIn = () => {
    const currentMin = parseFloat(minFreqInput) || 0;
    const currentMax = parseFloat(maxFreqInput) || 20000;
    const span = currentMax - currentMin;
    if (span <= 80) return; // guard min frequency span
    
    // Zoom toward the center of the current view
    const center = currentMin + span / 2;
    const newSpan = span * 0.7; // zoom in by 30%
    const newMin = Math.max(0, Math.round(center - newSpan / 2));
    const newMax = Math.round(center + newSpan / 2);
    
    setMinFreqInput(newMin.toString());
    setMaxFreqInput(newMax.toString());
  };

  const handleHzZoomOut = () => {
    const currentMin = parseFloat(minFreqInput) || 0;
    const currentMax = parseFloat(maxFreqInput) || 20000;
    const span = currentMax - currentMin;
    if (span >= 44005) return; // guard max frequency span
    
    const center = currentMin + span / 2;
    const newSpan = span / 0.7; // zoom out by 30%
    const newMin = Math.max(0, Math.round(center - newSpan / 2));
    const newMax = Math.min(48000, Math.round(center + newSpan / 2));
    
    setMinFreqInput(newMin.toString());
    setMaxFreqInput(newMax.toString());
  };

  const handleHzPanLeft = () => {
    const currentMin = parseFloat(minFreqInput) || 0;
    const currentMax = parseFloat(maxFreqInput) || 20000;
    const span = currentMax - currentMin;
    const shift = span * 0.25; // shift by 25% of current span
    
    const newMin = Math.max(0, Math.round(currentMin - shift));
    const newMax = Math.round(newMin + span);
    
    setMinFreqInput(newMin.toString());
    setMaxFreqInput(newMax.toString());
  };

  const handleHzPanRight = () => {
    const currentMin = parseFloat(minFreqInput) || 0;
    const currentMax = parseFloat(maxFreqInput) || 20000;
    const span = currentMax - currentMin;
    const shift = span * 0.25;
    
    const newMax = Math.min(48000, Math.round(currentMax + shift));
    const newMin = Math.max(0, Math.round(newMax - span));
    
    setMinFreqInput(newMin.toString());
    setMaxFreqInput(newMax.toString());
  };

  const handleHzReset = () => {
    setMinFreqInput('0');
    setMaxFreqInput('20000');
  };

  // --- VERTICAL SPECTRUM ZOOM & PAN HANDLERS ---
  const handleDbZoomIn = () => {
    const center = (maxDb + minDb) / 2;
    const span = maxDb - minDb;
    if (span <= 15) return; // guard minimum vertical decibel scale span
    const newSpan = span * 0.7;
    setMinDb(Math.round(center - newSpan / 2));
    setMaxDb(Math.round(center + newSpan / 2));
  };

  const handleDbZoomOut = () => {
    const center = (maxDb + minDb) / 2;
    const span = maxDb - minDb;
    if (span >= 160) return; // guard maximum vertical decibel scale span
    const newSpan = span / 0.7;
    setMinDb(Math.max(-160, Math.round(center - newSpan / 2)));
    setMaxDb(Math.min(10, Math.round(center + newSpan / 2)));
  };

  const handleDbPanUp = () => {
    const span = maxDb - minDb;
    const shift = Math.round(span * 0.2); // shift up/down by 20%
    if (maxDb + shift > 15) return;
    setMinDb(prev => prev + shift);
    setMaxDb(prev => prev + shift);
  };

  const handleDbPanDown = () => {
    const span = maxDb - minDb;
    const shift = Math.round(span * 0.2);
    if (minDb - shift < -170) return;
    setMinDb(prev => prev - shift);
    setMaxDb(prev => prev - shift);
  };

  const handleDbReset = () => {
    setMinDb(-120);
    setMaxDb(-10);
  };

  const calculatedSampleRate = actualSampleRate || (sampleRateOption === 'default' ? 44100 : parseInt(sampleRateOption));
  const fftBinWidthHz = calculatedSampleRate / fftSize;
  const fftTimeLengthMs = (fftSize / calculatedSampleRate) * 1000;

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900 flex flex-col font-sans antialiased selection:bg-blue-50 selection:text-blue-700">
      
      {/* Main Core Header App bar */}
      <nav id="navbar-main" className="border-b border-zinc-200 bg-white sticky top-0 z-30 px-6 py-4 shadow-sm">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3">
          
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-zinc-900 rounded-full flex items-center justify-center">
              <Activity className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-1.5 font-sans">
                <span className="font-bold text-zinc-900 tracking-tight text-base">
                  SonicTrim Pro
                </span>
                <span className="text-[10px] bg-zinc-100 text-zinc-800 font-mono px-1.5 py-0.5 rounded border border-zinc-200 font-bold">
                  v2.1
                </span>
              </div>
              <p className="text-xs text-zinc-500 uppercase tracking-widest font-semibold text-[10px]">
                Acoustic materials resonator & young's modulus calculator
              </p>
            </div>
          </div>
        </div>
      </nav>

      {/* Main Interactive Workshop Panel */}
      <main className="flex-1 w-full max-w-7xl mx-auto p-4 md:p-6 lg:py-8 space-y-6">
        
        {/* Top visual warning notice if using mic on raw untrusted frames */}
        <p className="text-xs text-zinc-650 text-center bg-zinc-100/50 py-2 px-4 rounded-xl border border-zinc-200/65">
          💡 Note: Accessing physical microphone devices requires secure contexts (HTTPS or localhost) for live audio input capturing.
        </p>

        {/* Dynamic Waveform Studio Editor (Draw trimmer ONLY if a sound buffer exists in memory!) */}
        <AnimatePresence mode="wait">
          {recordedAudio && (
            <motion.div
              key="waveform-editor-arena"
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.3 }}
              className="space-y-2.5"
            >
              <div className="flex items-center justify-between px-1">
                <span className="text-xs font-bold text-zinc-500 flex items-center gap-1.5 uppercase tracking-wider">
                  <Volume2 className="w-4 h-4 text-blue-600" /> Recorded Workspace Sound buffer
                </span>
                <button
                  type="button"
                  onClick={handleTestRecordingDelete}
                  className="text-xs text-red-500 hover:text-red-600 flex items-center gap-1 hover:bg-hover px-2.5 py-1 rounded transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" /> Clear Sound Buffer
                </button>
              </div>

              {/* Advanced Waveform trimmer component */}
              <WaveformTrimmer
                recordedAudio={recordedAudio}
                onTrimApply={applyCropToActive}
                onTrimReset={handleResetCropToOriginal}
                activeTrimStart={activeTrimStart}
                activeTrimEnd={activeTrimEnd}
                onChangeTrim={handleTrimUpdate}
                onPlayTrimmed={playTrimmedPlaybackSpan}
                onStopTrimmed={stopTrimmedPlayback}
                isPlaying={isPlayingTrimmed}
                playbackProgressRatio={playbackProgressRatio}
              />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Primary Workshop Split Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
          
          {/* LEFT SECTION - Pipeline Controllers, Audio Pickers, and Constants */}
          <div className="lg:col-span-1 space-y-6">
                 {/* CARD 1: Signal input hardware configurations */}
            <div className="bg-white border border-zinc-200 rounded-2xl p-5 shadow-sm space-y-4">
              <div className="flex items-center gap-2 border-b border-zinc-100 pb-3 font-sans">
                <h2 className="font-bold text-sm text-zinc-900 tracking-tight">
                  Signal Source Controls
                </h2>
              </div>

              {/* Source choosing toggle tabs */}
              <div className="grid grid-cols-2 gap-2 bg-zinc-50 p-1 rounded-xl border border-zinc-200">
                <button
                  type="button"
                  onClick={() => setAudioSource('mic')}
                  className={`flex items-center justify-center gap-1.5 py-2 px-3 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                    audioSource === 'mic' 
                      ? 'bg-white text-blue-600 border border-zinc-200 shadow-sm font-bold' 
                      : 'text-zinc-500 hover:text-zinc-900 border border-transparent'
                  }`}
                >
                  <Mic className="w-3.5 h-3.5" /> Microphone
                </button>
                <button
                  type="button"
                  onClick={() => setAudioSource('file')}
                  className={`flex items-center justify-center gap-1.5 py-2 px-3 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                    audioSource === 'file' 
                      ? 'bg-white text-blue-600 border border-zinc-200 shadow-sm font-bold' 
                      : 'text-zinc-500 hover:text-zinc-900 border border-transparent'
                  }`}
                >
                  <FileAudio className="w-3.5 h-3.5" /> Media File
                </button>
              </div>

              {/* Conditional options rendering based on pick */}
              {audioSource === 'mic' ? (
                <div className="space-y-3.5 animate-in fade-in duration-200">
                  
                  {/* Select MIC device */}
                  <div className="space-y-1.5">
                    <label className="text-[11px] text-zinc-500 uppercase tracking-wider font-bold">
                      Capture Device Hardware
                    </label>
                    <select
                      id="mic-device-select"
                      value={selectedMicId}
                      onChange={(e) => setSelectedMicId(e.target.value)}
                      className="w-full bg-white text-zinc-900 text-xs border border-zinc-200 p-2.5 rounded-xl focus:border-zinc-400 outline-none transition-all font-semibold"
                    >
                      <option value="">Default Microphone Mode</option>
                      {micDevices.map((device, idx) => (
                        <option key={device.deviceId || idx} value={device.deviceId}>
                          {device.label || `Audio Input ${idx + 1}`}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Prefix ID for recorded parameters file naming */}
                  <div className="space-y-1.5">
                    <label htmlFor="mic-prefix-id" className="text-[11px] text-zinc-455 uppercase tracking-wider font-bold">
                      Specimen Prefix ID tag
                    </label>
                    <input
                      id="mic-prefix-id"
                      type="text"
                      value={micPrefix}
                      onChange={(e) => setMicPrefix(e.target.value)}
                      placeholder="e.g. steel_rod_spec"
                      className="w-full bg-white text-zinc-900 text-xs border border-zinc-200 px-3 py-2.5 rounded-xl focus:border-zinc-450 focus:ring-1 focus:ring-zinc-400 outline-none font-mono"
                    />
                  </div>

                  {/* Recorder console triggers */}
                  <div className="bg-zinc-50 p-3 rounded-xl border border-zinc-200 space-y-2.5">
                    <div className="flex items-center justify-between text-xs font-semibold">
                      <span className="text-zinc-500 flex items-center gap-1">
                        <span className={`w-2 h-2 rounded-full ${isRecording ? 'bg-red-500 animate-ping' : 'bg-zinc-300'}`} />
                        {isRecording ? 'Recording active Mono WAV' : 'Recorder Standby'}
                      </span>
                      {isRecording && (
                        <span className="font-mono text-red-600 tracking-wider font-bold">
                          {recordingDuration.toFixed(1)}s
                        </span>
                      )}
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <button
                        id="start-rec-btn-app"
                        type="button"
                        onClick={startRecording}
                        disabled={isRecording || !isPipelineActive}
                        className="py-1.5 px-3 bg-red-50 border border-red-200 hover:bg-red-100 text-red-700 rounded-lg text-xs font-bold transition-all disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer flex items-center justify-center gap-1"
                      >
                        Start Capture
                      </button>
                      <button
                        id="stop-rec-btn-app"
                        type="button"
                        onClick={stopRecording}
                        disabled={!isRecording}
                        className="py-1.5 px-3 bg-white border border-zinc-200 hover:bg-zinc-50 text-zinc-800 rounded-lg text-xs font-bold transition-all disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer flex items-center justify-center gap-1 shadow-sm"
                      >
                        Stop Recording
                      </button>
                    </div>
                  </div>

                  {/* Mic play monitoring feedback to speakers */}
                  <div className="flex items-center justify-between px-1">
                    <span className="text-xs text-zinc-500" title="Check to route dynamic audio straight to headphones/speakers">
                      Monitor Live Mic (Feedback warning!)
                    </span>
                    <input
                      id="mic-monitor-checkbox"
                      type="checkbox"
                      checked={micMonitor}
                      onChange={(e) => setMicMonitor(e.target.checked)}
                      className="w-4 h-4 text-zinc-900 bg-white border-zinc-200 rounded focus:ring-zinc-400"
                    />
                  </div>

                </div>
              ) : (
                <div className="space-y-3.5 animate-in fade-in duration-200">
                  
                  {/* Select file element with beautiful UI trigger */}
                  <div className="space-y-1.5">
                    <label className="text-[11px] text-zinc-455 uppercase tracking-wider font-bold">
                      Load audio/video specimen file
                    </label>
                    <div className="relative group">
                      <input
                        id="audio-file-loader"
                        type="file"
                        accept="audio/*,video/*"
                        onChange={handleFileChange}
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                      />
                      <div className="w-full bg-zinc-50 text-zinc-800 border border-zinc-200 py-3.5 px-3 rounded-xl hover:border-zinc-300 transition-all flex items-center gap-2 text-xs font-medium shadow-sm">
                        <FileCheck className="w-4 h-4 text-blue-600" />
                        <span className="truncate text-zinc-650">
                          {selectedFileName || 'Choose sample file...'}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Media player element connected to our spectrum nodes */}
                  <div className={`mt-2 ${isVideoFile ? 'space-y-2' : ''}`}>
                    {isVideoFile && (
                      <span className="text-[10px] text-zinc-500 uppercase tracking-wider font-bold block">
                        Video Specimen Viewport
                      </span>
                    )}
                    <div className={
                      isVideoFile 
                        ? "relative aspect-video w-full rounded-xl border border-zinc-200 bg-zinc-950 overflow-hidden shadow-sm"
                        : "ambient-file-player bg-zinc-50 p-2 rounded-xl border border-zinc-200/60"
                    }>
                      <video
                        ref={fileElementRef}
                        controls
                        className={
                          isVideoFile
                            ? "w-full h-full object-contain"
                            : "w-full h-8 outline-none text-xs bg-transparent"
                        }
                      />
                      {isVideoFile && (
                        <div className="absolute top-2.5 left-2.5 bg-zinc-900/85 backdrop-blur border border-zinc-700 text-white px-2 py-1 rounded-md text-[9px] font-bold font-mono tracking-wider flex items-center gap-1.5 pointer-events-none shadow">
                          <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                          <span>VIDEO SPECIMEN FEED</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {selectedFile && (
                    <div className="pt-1.5 animate-in fade-in duration-200">
                      <button
                        id="copy-media-audio-btn"
                        type="button"
                        onClick={copyMediaAudioToStudio}
                        disabled={isImporting}
                        className="w-full flex items-center justify-center gap-2 py-2 px-3.5 bg-blue-50 border border-blue-200 hover:bg-blue-100 text-blue-700 disabled:bg-zinc-50 disabled:border-zinc-200 disabled:text-zinc-400 rounded-xl text-xs font-bold transition-all shadow-sm cursor-pointer disabled:cursor-not-allowed"
                      >
                        <Copy className="w-3.5 h-3.5" />
                        {isImporting ? 'Decoding Media Audio...' : 'Copy Audio to Waveform Studio'}
                      </button>
                      {importError && (
                        <p className="text-[10px] text-red-650 font-medium mt-1 select-none">
                          ⚠️ {importError}
                        </p>
                      )}
                    </div>
                  )}

                </div>
              )}

              {/* Denser FFT sizing controls */}
              <div className="grid grid-cols-2 gap-3.5 pt-1.5 border-t border-zinc-100">
                <div className="space-y-1.5">
                  <label htmlFor="fft-size-select" className="text-[10px] text-zinc-455 uppercase tracking-wider font-bold">
                    FFT Bin Sizing
                  </label>
                  <select
                    id="fft-size-select"
                    value={fftSize}
                    onChange={(e) => setFftSize(parseInt(e.target.value))}
                    className="w-full bg-white text-zinc-900 text-xs border border-zinc-200 p-2.5 rounded-xl focus:border-zinc-400 outline-none transition-all font-mono"
                  >
                    <option value="256">256 bins</option>
                    <option value="512">512 bins</option>
                    <option value="1024">1,024 bins</option>
                    <option value="2048">2,048 (Std)</option>
                    <option value="4096">4,096 bins</option>
                    <option value="8192">8,192 bins</option>
                    <option value="16384">16,384 bins</option>
                    <option value="32768">32,768 bins</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="samplerate-select" className="text-[10px] text-zinc-500 uppercase tracking-wider font-bold animate-pulse-none">
                    ADC sample rate
                  </label>
                  <select
                    id="samplerate-select"
                    value={sampleRateOption}
                    onChange={(e) => setSampleRateOption(e.target.value)}
                    className="w-full bg-white text-zinc-900 text-xs border border-zinc-200 p-2.5 rounded-xl focus:border-zinc-400 outline-none transition-all font-mono"
                  >
                    <option value="default">Device Default</option>
                    <option value="8000">8.00 kHz</option>
                    <option value="16000">16.0 kHz</option>
                    <option value="22050">22.05 kHz</option>
                    <option value="32000">32.0 kHz</option>
                    <option value="44100">44.1 kHz</option>
                    <option value="48000">48.0 kHz</option>
                    <option value="96000">96.0 kHz</option>
                  </select>
                </div>
              </div>

              {/* Real-time FFT physics info panel */}
              <div id="fft-physics-info-banner" className="bg-zinc-50 border border-zinc-200/80 rounded-xl p-3 space-y-2 animate-in fade-in duration-200">
                <div className="flex items-center justify-between text-zinc-450 uppercase tracking-wider text-[9px] font-extrabold border-b border-zinc-200/55 pb-1">
                  <span>FFT Physical Spacings</span>
                  <span className="text-blue-600 lowercase font-bold font-mono">
                    {calculatedSampleRate >= 1000 ? `${(calculatedSampleRate / 1000).toFixed(1)} kHz` : `${calculatedSampleRate} Hz`}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-[11px] select-none">
                  <div className="bg-white p-2.5 rounded-lg border border-zinc-200/50 shadow-xs flex flex-col justify-between">
                    <div>
                      <span className="text-[9px] text-zinc-400 font-bold block uppercase tracking-tight">FFT Bin Width</span>
                      <span className="font-mono font-bold text-zinc-800 text-[12px] block mt-0.5">
                        {fftBinWidthHz.toFixed(3)} Hz
                      </span>
                    </div>
                    <p className="text-[9px] text-zinc-400 mt-1 leading-snug">
                      Frequency spacing between successive discrete bins (accuracy limit).
                    </p>
                  </div>
                  <div className="bg-white p-2.5 rounded-lg border border-zinc-200/50 shadow-xs flex flex-col justify-between">
                    <div>
                      <span className="text-[9px] text-zinc-400 font-bold block uppercase tracking-tight">Time Representation</span>
                      <span className="font-mono font-bold text-zinc-800 text-[12px] block mt-0.5">
                        {fftTimeLengthMs.toFixed(2)} ms
                      </span>
                    </div>
                    <p className="text-[9px] text-zinc-400 mt-1 leading-snug">
                      Data packet duration represented by {fftSize} sample points.
                    </p>
                  </div>
                </div>
              </div>

              {/* Master apply connection button */}
              <button
                id="apply-audio-source-btn"
                type="button"
                onClick={handleStartPipeline}
                className="w-full py-2.5 px-4 bg-zinc-900 hover:bg-zinc-800 text-white rounded-xl text-xs font-bold transition-all shadow-sm active:scale-98 cursor-pointer flex items-center justify-center gap-1.5"
                title="Initialize and activate the real-time audio pipeline"
              >
                <Activity className="w-4 h-4 text-blue-400" /> Start Acoustic Pipeline
              </button>

            </div>

            {/* CARD 2: Physical properties calculations */}
            <div className="bg-white border border-zinc-200 rounded-2xl p-5 shadow-sm space-y-4">
              <div className="flex items-center gap-2 border-b border-zinc-100 pb-3 font-sans">
                <h2 className="font-bold text-sm text-zinc-900 tracking-tight">
                  Material Specimen Parameters
                </h2>
              </div>

              <div className="grid grid-cols-2 gap-3">
                
                <div className="space-y-1">
                  <label htmlFor="material-width" className="text-[10px] text-zinc-500 uppercase tracking-wider font-bold">
                    Width (mm)
                  </label>
                  <input
                    id="material-width"
                    type="number"
                    step="0.1"
                    min="0.1"
                    value={material.width}
                    onChange={(e) => setMaterial(prev => ({ ...prev, width: parseFloat(e.target.value) || 0 }))}
                    className="w-full bg-white text-zinc-900 text-xs border border-zinc-200 px-3 py-1.5 rounded-xl outline-none focus:border-zinc-400 font-mono font-semibold"
                  />
                </div>

                <div className="space-y-1">
                  <label htmlFor="material-thickness" className="text-[10px] text-zinc-500 uppercase tracking-wider font-bold">
                    Thickness (mm)
                  </label>
                  <input
                    id="material-thickness"
                    type="number"
                    step="0.1"
                    min="0.1"
                    value={material.thickness}
                    onChange={(e) => setMaterial(prev => ({ ...prev, thickness: parseFloat(e.target.value) || 0 }))}
                    className="w-full bg-white text-zinc-900 text-xs border border-zinc-200 px-3 py-1.5 rounded-xl outline-none focus:border-zinc-400 font-mono font-semibold"
                  />
                </div>

                <div className="space-y-1">
                  <label htmlFor="material-length" className="text-[10px] text-zinc-500 uppercase tracking-wider font-bold">
                    Length (mm)
                  </label>
                  <input
                    id="material-length"
                    type="number"
                    step="1"
                    min="1"
                    value={material.length}
                    onChange={(e) => setMaterial(prev => ({ ...prev, length: parseFloat(e.target.value) || 0 }))}
                    className="w-full bg-white text-zinc-900 text-xs border border-zinc-200 px-3 py-1.5 rounded-xl outline-none focus:border-zinc-400 font-mono font-semibold"
                  />
                </div>

                <div className="space-y-1">
                  <label htmlFor="material-mass" className="text-[10px] text-zinc-500 uppercase tracking-wider font-bold">
                    Mass (kg)
                  </label>
                  <input
                    id="material-mass"
                    type="number"
                    step="0.001"
                    min="0.001"
                    value={material.mass}
                    onChange={(e) => setMaterial(prev => ({ ...prev, mass: parseFloat(e.target.value) || 0 }))}
                    className="w-full bg-white text-zinc-900 text-xs border border-zinc-200 px-3 py-1.5 rounded-xl outline-none focus:border-zinc-400 font-mono font-semibold"
                  />
                </div>

              </div>

              {/* Instant Specimen Density feedback & override */}
              <div className="pt-2 border-t border-zinc-100 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-zinc-500 uppercase tracking-wider font-bold block">
                    Density Specific Override
                  </span>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={useOverrideDensity}
                      onChange={(e) => setUseOverrideDensity(e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-8 h-4.5 bg-zinc-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-zinc-300 after:border after:rounded-full after:h-3.5 after:w-3.5 after:transition-all peer-checked:bg-purple-600"></div>
                  </label>
                </div>

                {useOverrideDensity && (
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-zinc-400 uppercase font-bold tracking-wider">Override Value:</span>
                    <div className="relative flex-1">
                      <input
                        id="density-override-input"
                        type="number"
                        step="1"
                        min="1"
                        value={overrideDensityInput}
                        onChange={(e) => setOverrideDensityInput(e.target.value)}
                        placeholder="e.g. 7850"
                        className="w-full bg-white text-zinc-900 text-xs border border-zinc-200 pl-3 pr-14 py-1.5 rounded-xl outline-none focus:border-zinc-400 font-mono font-semibold text-right"
                      />
                      <span className="absolute right-3 top-1.5 text-[10px] text-zinc-400 font-semibold font-mono">kg/m³</span>
                    </div>
                  </div>
                )}

                <div className="bg-zinc-50 p-3 rounded-xl border border-zinc-200 space-y-1.5">
                  <div className="flex items-center justify-between text-xs font-semibold">
                    <span className="text-zinc-500 font-bold uppercase tracking-wider text-[10px]">
                      Estimated Density (from Dimensions):
                    </span>
                    <span className="font-mono font-bold text-zinc-600">
                      {calculatedDensity ? `${calculatedDensity.toFixed(1)} kg/m³` : '--'}
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-xs font-semibold pt-1.5 border-t border-zinc-200">
                    <span className="text-zinc-500 font-bold uppercase tracking-wider text-[10px]">
                      Active Density used:
                    </span>
                    <span className={`font-mono font-bold text-sm ${useOverrideDensity ? 'text-purple-600' : 'text-blue-600'}`}>
                      {activeDensity ? `${activeDensity.toFixed(1)} kg/m³` : '--'}
                    </span>
                  </div>
                  {useOverrideDensity && (
                    <div className="text-[9px] text-purple-600 font-medium font-sans">
                      ⚠ All Elastic Young's Modulus (E) calculations are using this override density.
                    </div>
                  )}
                </div>
              </div>

            </div>

            {/* CARD 3: Anchor parameters and grids constraints */}
            <div className="bg-white border border-zinc-200 rounded-2xl p-5 shadow-sm space-y-4">
              <div className="flex items-center gap-2 border-b border-zinc-100 pb-3 font-sans">
                <h2 className="font-bold text-sm text-zinc-900 tracking-tight">
                  Custom Markers & Boundaries
                </h2>
              </div>

              {/* Viewport Bounds limit settings */}
              <div>
                <span className="text-[10px] text-zinc-500 uppercase tracking-wider font-bold block mb-1.5">
                  Viewport Spectral limits (Hz)
                </span>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <input
                    id="viewport-min-freq"
                    type="number"
                    value={minFreqInput}
                    onChange={(e) => setMinFreqInput(e.target.value)}
                    placeholder="Min (e.g. 0)"
                    className="w-full bg-white border border-zinc-200 p-2.5 rounded-xl outline-none text-center font-mono placeholder:text-zinc-400 focus:border-zinc-400 font-semibold"
                  />
                  <input
                    id="viewport-max-freq"
                    type="number"
                    value={maxFreqInput}
                    onChange={(e) => setMaxFreqInput(e.target.value)}
                    placeholder="Max (e.g. 20000)"
                    className="w-full bg-white border border-zinc-200 p-2.5 rounded-xl outline-none text-center font-mono placeholder:text-zinc-400 focus:border-zinc-400 font-semibold"
                  />
                </div>
              </div>

              {/* Marker lines (E & G) inputs */}
              <div className="space-y-2">
                <span className="text-[10px] text-slate-400 uppercase tracking-wider font-bold block">
                  Marker Highlight Parameters (E & G)
                </span>
                <div className="grid grid-cols-2 gap-3">
                  <div className="relative">
                    <span className="absolute left-3 top-2.5 text-[11px] text-blue-600 font-bold font-mono">E</span>
                    <input
                      id="marker-E-val"
                      type="number"
                      step="any"
                      value={markerE}
                      onChange={(e) => setMarkerE(e.target.value)}
                      placeholder="e.g. 200"
                      className="w-full bg-white text-zinc-900 text-xs border border-zinc-200 pl-7 pr-3 py-2.5 rounded-xl outline-none focus:border-zinc-400 font-mono text-right font-semibold"
                    />
                  </div>

                  <div className="relative">
                    <span className="absolute left-3 top-2.5 text-[11px] text-purple-600 font-bold font-mono">G</span>
                    <input
                      id="marker-G-val"
                      type="number"
                      step="any"
                      value={markerG}
                      onChange={(e) => setMarkerG(e.target.value)}
                      placeholder="e.g. 1.0"
                      className="w-full bg-white text-zinc-900 text-xs border border-zinc-200 pl-7 pr-3 py-2.5 rounded-xl outline-none focus:border-zinc-400 font-mono text-right font-semibold"
                    />
                  </div>
                </div>

                {markerE && markerG && !isNaN(parseFloat(markerE)) && !isNaN(parseFloat(markerG)) && (
                  <div className="text-[10px] text-zinc-500 font-mono bg-zinc-50 p-2.5 rounded-xl border border-zinc-150 space-y-1">
                    <div className="flex justify-between items-center">
                      <span className="font-semibold text-zinc-700">Base Freq (E×G):</span>
                      <span className="font-bold text-zinc-900">{(parseFloat(markerE) * parseFloat(markerG)).toFixed(1)} Hz</span>
                    </div>
                    <div className="text-[9px] text-zinc-400">
                      Calculated 1x to 12x highlights are displayed on the spectrograph.
                    </div>
                  </div>
                )}
              </div>

            </div>

          </div>

          {/* RIGHT SECTION - Spectrograph visualizer & calculations metrics output dashboard */}
          <div className="lg:col-span-2 space-y-6">
            
            {/* CARD 1: Audio Spectrum display canvas */}
            <div className="bg-white border border-zinc-200 rounded-2xl p-5 shadow-sm space-y-4">
              
              <div className="flex items-center justify-between border-b border-zinc-100 pb-3">
                <div className="flex items-center gap-2 font-sans">
                  <h2 className="font-bold text-sm text-zinc-900 tracking-tight">
                    Linear FFT Spectrograph
                  </h2>
                </div>
                
                {/* Visualizer triggers */}
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] px-2 py-0.5 rounded font-bold font-mono border ${
                    isPipelineActive 
                      ? 'bg-blue-50 text-blue-700 border-blue-200 animate-pulse' 
                      : 'bg-zinc-100 text-zinc-500 border-zinc-200'
                  }`}>
                    {isPipelineActive ? '● PIPELINE LIVE' : '○ PIPELINE IDLE'}
                  </span>

                  <button
                    id="reset-maxhold-btn-canvas"
                    type="button"
                    onClick={handleResetMaxHold}
                    className="px-2.5 py-1 bg-white hover:bg-zinc-50 text-zinc-700 border border-zinc-200 rounded-lg text-xs font-bold cursor-pointer transition-all flex items-center gap-1 active:scale-95 shadow-sm"
                    title="Clear the persistent maximum envelope trace"
                  >
                    <RefreshCw className="w-3 h-3 text-zinc-400" />
                    Reset Peak Trace
                  </button>
                </div>
              </div>

              {/* Visualizer Canvas box */}
              <div className="relative bg-zinc-50 rounded-xl overflow-hidden border border-zinc-200 group">
                <canvas
                  ref={canvasRef}
                  width={760}
                  height={380}
                  className="w-full h-80 md:h-[400px] display-block rounded-xl"
                  id="fftSpectrumCanvas"
                />

                {/* Vertical envelope guide keys overlay corner */}
                <div className="absolute top-3 left-3 bg-white/95 backdrop-blur border border-zinc-200 px-3 py-2 rounded-lg text-[10px] space-y-1 text-zinc-500 pointer-events-none shadow-sm">
                  <div className="flex items-center gap-1.5 font-bold">
                    <span className="w-2.5 h-1 bg-blue-600 rounded-sm" />
                    <span>Live Wave Envelope</span>
                  </div>
                  <div className="flex items-center gap-1.5 font-bold">
                    <span className="w-2.5 h-1 bg-red-500 rounded-sm" />
                    <span>Max Hold Envelope Trace</span>
                  </div>
                </div>

                {/* FFT Physical properties specs overlay corner */}
                <div className="absolute top-3 right-3 bg-white/95 backdrop-blur border border-zinc-200 px-3 py-2 rounded-lg text-[10px] space-y-1 text-zinc-500 text-right pointer-events-none shadow-sm select-none">
                  <div className="font-bold text-[9px] uppercase tracking-wider text-zinc-400 border-b border-zinc-100 pb-0.5 mb-1">
                    FFT Resolution Specs
                  </div>
                  <div>
                    Bin Width: <span className="font-mono font-bold text-zinc-800">{fftBinWidthHz.toFixed(2)} Hz</span>
                  </div>
                  <div>
                    Window Time: <span className="font-mono font-bold text-zinc-800">{fftTimeLengthMs.toFixed(1)} ms</span>
                  </div>
                </div>
              </div>

              {/* Dynamic Axis Zoom & Pan Dashboard Controls */}
              <div id="spectrograph-zoom-pan-controls" className="bg-zinc-50/50 p-4 rounded-xl border border-zinc-200 grid grid-cols-1 md:grid-cols-2 gap-4 text-xs animate-in fade-in duration-200">
                {/* Horizontal frequency axes controls (X) */}
                <div className="space-y-2 flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-bold text-zinc-650 uppercase tracking-wider text-[10px] flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
                        X-Axis (Frequency Zoom)
                      </span>
                      <span className="font-mono text-[9px] bg-zinc-150/60 text-zinc-600 px-1.5 py-0.5 rounded font-bold border border-zinc-200/50 shadow-sm">
                        {Math.round(minFreq)} - {Math.round(maxFreq)} Hz
                      </span>
                    </div>
                    <p className="text-[9.5px] text-zinc-400 select-none pb-0.5">
                      Focus frequency span onto resonance zones.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 pt-1">
                    <button
                      id="hz-zoom-in-btn"
                      type="button"
                      onClick={handleHzZoomIn}
                      className="px-2.5 py-1.5 bg-white hover:bg-zinc-100 border border-zinc-200 rounded-xl text-[11px] font-bold text-zinc-700 active:scale-95 transition-all flex items-center gap-1 cursor-pointer shadow-sm select-none"
                      title="Zoom In (narrows frequency view span)"
                    >
                      <ZoomIn className="w-3.5 h-3.5 text-zinc-500" />
                      In
                    </button>
                    <button
                      id="hz-zoom-out-btn"
                      type="button"
                      onClick={handleHzZoomOut}
                      className="px-2.5 py-1.5 bg-white hover:bg-zinc-100 border border-zinc-200 rounded-xl text-[11px] font-bold text-zinc-700 active:scale-95 transition-all flex items-center gap-1 cursor-pointer shadow-sm select-none"
                      title="Zoom Out (widens frequency view span)"
                    >
                      <ZoomOut className="w-3.5 h-3.5 text-zinc-500" />
                      Out
                    </button>
                    <button
                      id="hz-pan-left-btn"
                      type="button"
                      onClick={handleHzPanLeft}
                      className="px-2 py-1.5 bg-white hover:bg-zinc-100 border border-zinc-200 rounded-xl text-[11px] font-bold text-zinc-700 active:scale-95 transition-all flex items-center gap-1 cursor-pointer shadow-sm select-none"
                      title="Shift view left"
                    >
                      <ChevronLeft className="w-3.5 h-3.5 text-zinc-500" />
                      Left
                    </button>
                    <button
                      id="hz-pan-right-btn"
                      type="button"
                      onClick={handleHzPanRight}
                      className="px-2 py-1.5 bg-white hover:bg-zinc-100 border border-zinc-200 rounded-xl text-[11px] font-bold text-zinc-700 active:scale-95 transition-all flex items-center gap-1 cursor-pointer shadow-sm select-none"
                      title="Shift view right"
                    >
                      <ChevronRight className="w-3.5 h-3.5 text-zinc-500" />
                      Right
                    </button>
                    <button
                      id="hz-reset-btn"
                      type="button"
                      onClick={handleHzReset}
                      className="px-2.5 py-1.5 bg-zinc-100 hover:bg-zinc-200 text-zinc-700 rounded-xl text-[10px] font-bold active:scale-95 transition-all cursor-pointer border border-zinc-200/40 select-none"
                      title="Reset frequency viewport bounds to full standard"
                    >
                      Reset X
                    </button>
                    
                    <span className="h-4 w-[1px] bg-zinc-200 mx-1 block hidden sm:inline" />
                    
                    <div className="flex items-center gap-1 mt-1 sm:mt-0">
                      <button
                        id="hz-preset-low-btn"
                        type="button"
                        onClick={() => { setMinFreqInput('0'); setMaxFreqInput('4000'); }}
                        className="px-2 py-1 bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-100 rounded-lg text-[9px] font-bold transition-all cursor-pointer select-none"
                        title="Set to 0 - 4 kHz (ideal for wood, resin, metal young's modulus resonance)"
                      >
                        0-4k
                      </button>
                      <button
                        id="hz-preset-full-btn"
                        type="button"
                        onClick={() => { setMinFreqInput('0'); setMaxFreqInput('20000'); }}
                        className="px-2 py-1 bg-purple-50 hover:bg-purple-100 text-purple-700 border border-purple-100 rounded-lg text-[9px] font-bold transition-all cursor-pointer select-none"
                        title="Set to full human audible scale (0 - 20 kHz)"
                      >
                        0-20k
                      </button>
                    </div>
                  </div>
                </div>

                {/* Vertical amplitude dB scale controls (Y) */}
                <div className="space-y-2 flex flex-col justify-between border-t md:border-t-0 md:border-l border-zinc-200/80 pt-3 md:pt-0 md:pl-4">
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-bold text-zinc-650 uppercase tracking-wider text-[10px] flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse" />
                        Y-Axis (Decibel Zoom)
                      </span>
                      <span className="font-mono text-[9px] bg-zinc-150/60 text-zinc-600 px-1.5 py-0.5 rounded font-bold border border-zinc-200/50 shadow-sm">
                        {minDb} to {maxDb} dB
                      </span>
                    </div>
                    <p className="text-[9.5px] text-zinc-400 select-none pb-0.5">
                      Shift amplitude floor to isolate whispering and background noise.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 pt-1">
                    <button
                      id="db-zoom-in-btn"
                      type="button"
                      onClick={handleDbZoomIn}
                      className="px-2.5 py-1.5 bg-white hover:bg-zinc-100 border border-zinc-200 rounded-xl text-[11px] font-bold text-zinc-700 active:scale-95 transition-all flex items-center gap-1 cursor-pointer shadow-sm select-none"
                      title="Vertical Zoom In (magnifies amplitude resolution)"
                    >
                      <ZoomIn className="w-3.5 h-3.5 text-zinc-500" />
                      In
                    </button>
                    <button
                      id="db-zoom-out-btn"
                      type="button"
                      onClick={handleDbZoomOut}
                      className="px-2.5 py-1.5 bg-white hover:bg-zinc-100 border border-zinc-200 rounded-xl text-[11px] font-bold text-zinc-700 active:scale-95 transition-all flex items-center gap-1 cursor-pointer shadow-sm select-none"
                      title="Vertical Zoom Out"
                    >
                      <ZoomOut className="w-3.5 h-3.5 text-zinc-500" />
                      Out
                    </button>
                    <button
                      id="db-pan-up-btn"
                      type="button"
                      onClick={handleDbPanUp}
                      className="px-2 py-1.5 bg-white hover:bg-zinc-100 border border-zinc-200 rounded-xl text-[11px] font-bold text-zinc-700 active:scale-95 transition-all flex items-center gap-1 cursor-pointer shadow-sm select-none"
                      title="Shift view up (focuses on loud signals)"
                    >
                      <ChevronUp className="w-3.5 h-3.5 text-zinc-500" />
                      Up
                    </button>
                    <button
                      id="db-pan-down-btn"
                      type="button"
                      onClick={handleDbPanDown}
                      className="px-2 py-1.5 bg-white hover:bg-zinc-100 border border-zinc-200 rounded-xl text-[11px] font-bold text-zinc-700 active:scale-95 transition-all flex items-center gap-1 cursor-pointer shadow-sm select-none"
                      title="Shift view down (exposes low dynamic noise)"
                    >
                      <ChevronDown className="w-3.5 h-3.5 text-zinc-500" />
                      Down
                    </button>
                    <button
                      id="db-reset-btn"
                      type="button"
                      onClick={handleDbReset}
                      className="px-2.5 py-1.5 bg-zinc-100 hover:bg-zinc-200 text-zinc-700 rounded-xl text-[10px] font-bold active:scale-95 transition-all cursor-pointer border border-zinc-200/40 select-none"
                      title="Reset vertical decibel parameters to standard -120 to -10 dB"
                    >
                      Reset Y
                    </button>
                  </div>
                </div>
              </div>

              <p className="text-[11px] text-zinc-500 leading-snug px-1">
                The visualizer is calibrated to linear scale frequency steps. Vertical dashed lines trace custom highlights, active resonance peaks (<strong className="text-blue-650">blue</strong> for live dynamic peaks, <strong className="text-red-500">red</strong> for max hold envelope peak). Update specimen constant sizes to evaluate elasticity values!
              </p>

            </div>

            {/* CARD 2: Metrics dashboard (Frequency peak amplitude + values) */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              
              {/* Box 1: Dynamic Acoustic frequency peaks findings */}
              <div className="bg-white border border-zinc-200 rounded-2xl p-5 shadow-sm space-y-4">
                <div className="flex items-center gap-2 border-b border-zinc-100 pb-3 text-xs uppercase tracking-wider font-bold text-zinc-500 font-sans">
                  Peak Frequency Reports
                </div>

                <div className="grid grid-cols-2 gap-4">
                  
                  <div className="p-3 bg-zinc-50 rounded-xl border border-zinc-200 flex flex-col gap-1 text-center">
                    <span className="text-[10px] text-zinc-500 uppercase font-bold">Peak (Live)</span>
                    <span id="label-live-peak" className="font-mono text-lg font-bold text-blue-600 tracking-tight">
                      {livePeakFreq ? `${livePeakFreq.toFixed(1)} Hz` : '-- Hz'}
                    </span>
                    <span className="text-[9px] text-zinc-500">
                      Amp: {livePeakAmp ? `${(livePeakAmp * 100).toFixed(1)} %` : '--'}
                    </span>
                  </div>

                  <div className="p-3 bg-zinc-50 rounded-xl border border-zinc-200 flex flex-col gap-1 text-center">
                    <span className="text-[10px] text-red-500 uppercase font-bold">Peak (Max Hold)</span>
                    <span id="label-maxhold-peak" className="font-mono text-lg font-bold text-red-500 tracking-tight">
                      {maxHoldPeakFreq ? `${maxHoldPeakFreq.toFixed(1)} Hz` : '-- Hz'}
                    </span>
                    <span className="text-[9px] text-zinc-500">Envelope Max Peak</span>
                  </div>

                </div>

                <div className="flex items-center justify-between text-xs px-1 text-zinc-500 font-bold">
                  <span>ADC rate active:</span>
                  <span className="font-mono text-zinc-700 font-bold">{actualSampleRate ? `${actualSampleRate} Hz` : '--'}</span>
                </div>

              </div>

                       {/* Box 2: Elastic modulus Young's calculated value dashboards */}
              <div className="bg-white border border-zinc-200 rounded-2xl p-5 shadow-sm space-y-4">
                <div className="flex items-center gap-2 border-b border-zinc-100 pb-3 text-xs uppercase tracking-wider font-bold text-zinc-500 font-sans">
                  Elastic Young's Modulus (E)
                </div>

                <div className="space-y-3">
                  
                  {/* Modulus E from Live frequencies */}
                  <div className="grid grid-cols-2 gap-3 pb-2 border-b border-zinc-100">
                    <div>
                      <span className="text-[10px] text-zinc-500 block font-bold truncate leading-tight">
                        Live E (User Formula)
                      </span>
                      <strong className="font-mono text-sm text-blue-600 tracking-tight leading-normal font-bold">
                        {liveCalculated.modulusUser ? `${liveCalculated.modulusUser.toFixed(2)} N/mm²` : '--'}
                      </strong>
                    </div>
                    <div>
                      <span className="text-[10px] text-zinc-500 block font-bold truncate leading-tight">
                        Live E (Euler Phys)
                      </span>
                      <strong className="font-mono text-sm text-zinc-800 tracking-tight leading-normal font-bold">
                        {liveCalculated.modulusPhys ? `${liveCalculated.modulusPhys.toFixed(2)} N/mm²` : '--'}
                      </strong>
                    </div>
                  </div>

                  {/* Modulus E from Max Hold envelopes */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <span className="text-[10px] text-red-500 block font-bold truncate leading-tight">
                        Max-Hold E (User)
                      </span>
                      <strong className="font-mono text-sm text-red-500 tracking-tight leading-normal font-bold">
                        {maxCalculated.modulusUser ? `${maxCalculated.modulusUser.toFixed(2)} N/mm²` : '--'}
                      </strong>
                    </div>
                    <div>
                      <span className="text-[10px] text-zinc-500 block font-bold truncate leading-tight">
                        Max-Hold E (Euler Phys)
                      </span>
                      <strong className="font-mono text-sm text-zinc-800 tracking-tight leading-normal font-bold">
                        {maxCalculated.modulusPhys ? `${maxCalculated.modulusPhys.toFixed(2)} N/mm²` : '--'}
                      </strong>
                    </div>
                  </div>

                </div>

              </div>

            </div>

            {/* CARD 3: Copy / report console block */}
            <div className="bg-zinc-50 border border-zinc-200 rounded-2xl p-5 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="text-xs text-zinc-500 leading-snug animate-pulse-none">
                <strong className="text-zinc-900">Specimen reporting</strong>: Generate a complete elastic young modulus report including length, mass, computed density, and resonance peak frequencies in 1 click!
              </div>

              <button
                id="copy-material-report-btn"
                type="button"
                onClick={copyFormattedMaterialData}
                className={`py-2.5 px-4 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer flex-shrink-0 ${
                  isCopied 
                    ? 'bg-blue-600 text-white font-bold animate-pulse-none' 
                    : 'bg-zinc-900 hover:bg-zinc-800 text-white border border-zinc-200'
                }`}
              >
                {isCopied ? (
                  <>
                    <Check className="w-3.5 h-3.5" /> Specimen Data Copied!
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" /> Copy Specimen Data
                  </>
                )}
              </button>
            </div>

          </div>

        </div>

      </main>

      {/* Footer bar */}
      <footer className="border-t border-zinc-200 bg-zinc-50 py-6 mt-12 text-center text-xs text-zinc-500">
        <div className="max-w-7xl mx-auto px-4 space-y-1">
          <p className="font-semibold text-zinc-700">
            Linear FFT Acoustical Spectrum Analyzer & Modulus Calculator — Designed with React, Vite & Tailwind CSS.
          </p>
          <p className="text-[10px] text-zinc-400 font-mono">
            Requires Localhost or HTTPS context for audio hardware APIs. Tap Simulation is provided as sandboxed evaluator.
          </p>
        </div>
      </footer>

    </div>
  );
}
