'use client';

import React, { useState, useRef } from 'react';

// Subtitle/Segment Interface
interface RecapSegment {
  id: string;
  start: number;
  end: number;
  text: string;
}

interface InteractiveRecapEditorProps {
  initialVideoUrl: string;
  initialSegments: RecapSegment[];
  onSave?: (updatedSegments: RecapSegment[]) => void;
}

export default function InteractiveRecapEditor({
  initialVideoUrl,
  initialSegments,
  onSave,
}: InteractiveRecapEditorProps) {
  const [segments, setSegments] = useState<RecapSegment[]>(initialSegments);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  // ဗီဒီယို အချိန်ပြောင်းလဲသည့်အခါ လက်ရှိအချိန်ကို မှတ်သားရန်
  const handleTimeUpdate = () => {
    if (videoRef.current) {
      setCurrentTime(videoRef.current.currentTime);
    }
  };

  // စာသားကို တိုက်ရိုက်ပြင်ဆင်သည့်အခါ
  const handleTextChange = (id: string, newText: string) => {
    setSegments((prev) =>
      prev.map((seg) => (seg.id === id ? { ...seg, text: newText } : seg))
    );
  };

  // သတ်မှတ်ထားသော Segment ၏ အစအချိန်သို့ ဗီဒီယိုကို ခုန်ကူးရန်
  const jumpToTime = (startTime: number) => {
    if (videoRef.current) {
      videoRef.current.currentTime = startTime;
      videoRef.current.play();
      setIsPlaying(true);
    }
  };

  // ပြင်ဆင်ပြီးသား အချက်အလက်များကို သိမ်းဆည်းရန်
  const handleSaveChanges = () => {
    if (onSave) {
      onSave(segments);
    }
    alert('အပြောင်းအလဲများကို အောင်မြင်စွာ သိမ်းဆည်းပြီးပါပြီ!');
  };

  return (
    <div className="flex flex-col lg:flex-row gap-6 p-6 max-w-7xl mx-auto bg-slate-900 text-white rounded-xl shadow-2xl">
      {/* ဘယ်ဘက်ခြမ်း - Video Preview Player */}
      <div className="lg:w-1/2 flex flex-col gap-4">
        <h2 className="text-xl font-bold text-emerald-400">🎬 Video Preview Player</h2>
        <div className="relative bg-black rounded-lg overflow-hidden aspect-video shadow-inner">
          <video
            ref={videoRef}
            src={initialVideoUrl}
            controls
            onTimeUpdate={handleTimeUpdate}
            onPlay={() => setIsPlaying(true)}
            onPause={() => setIsPlaying(false)}
            className="w-full h-full object-contain"
          />
        </div>
        <div className="text-sm text-slate-400">
          လက်ရှိ ဗီဒီယိုအချိန်: <span className="text-amber-400 font-mono">{currentTime.toFixed(2)}s</span>
        </div>
      </div>

      {/* ညာဘက်ခြမ်း - Interactive Subtitle & Script Editor */}
      <div className="lg:w-1/2 flex flex-col gap-4">
        <div className="flex justify-between items-center">
          <h2 className="text-xl font-bold text-emerald-400">✏️ Interactive Subtitle Editor</h2>
          <button
            onClick={handleSaveChanges}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded-lg shadow transition-colors"
          >
            ပြောင်းလဲမှုများ သိမ်းဆည်းမည်
          </button>
        </div>

        <p className="text-xs text-slate-400">
          * စာသားတစ်ခုချင်းစီကို တိုက်ရိုက်နှိပ်၍ ပြင်ဆင်နိုင်ပါသည်။ အချိန်ကို နှိပ်၍ ဗီဒီယိုကို ထိုနေရာသို့ ခုန်ကူးနိုင်ပါသည်။
        </p>

        {/* Segments List */}
        <div className="flex flex-col gap-3 max-h-[500px] overflow-y-auto pr-2">
          {segments.map((seg) => {
            // လက်ရှိ ဗီဒီယိုကစားနေသည့် အချိန်နှင့် ကိုက်ညီသော segment ကို highlight လုပ်ရန်
            const isActive = currentTime >= seg.start && currentTime <= seg.end;

            return (
              <div
                key={seg.id}
                className={`p-3 rounded-lg border transition-all flex flex-col gap-2 ${
                  isActive
                    ? 'bg-slate-800 border-emerald-500 shadow-md'
                    : 'bg-slate-800/50 border-slate-700 hover:border-slate-600'
                }`}
              >
                <div className="flex justify-between items-center text-xs">
                  <button
                    onClick={() => jumpToTime(seg.start)}
                    className="text-amber-400 hover:underline font-mono bg-slate-900/80 px-2 py-1 rounded"
                  >
                    ⏱️ {seg.start.toFixed(1)}s - {seg.end.toFixed(1)}s
                  </button>
                  {isActive && <span className="text-emerald-400 font-semibold animate-pulse">● Playing</span>}
                </div>

                <textarea
                  value={seg.text}
                  onChange={(e) => handleTextChange(seg.id, e.target.value)}
                  rows={2}
                  className="w-full bg-slate-900 text-slate-100 p-2 rounded border border-slate-700 focus:border-emerald-500 focus:outline-none text-sm resize-none"
                  placeholder="မြန်မာစာသားကို ဤနေရာတွင် ပြင်ဆင်ပါ..."
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}