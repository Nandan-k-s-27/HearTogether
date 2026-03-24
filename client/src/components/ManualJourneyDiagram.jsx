function Node({ label, tone = 'blue' }) {
  const toneClasses = tone === 'emerald'
    ? 'border-emerald-300/40 bg-emerald-500/15 text-emerald-100'
    : 'border-blue-300/40 bg-blue-500/15 text-blue-100';

  return (
    <div className={`rounded-xl border px-3 py-2 text-[11px] font-semibold tracking-wide ${toneClasses}`}>
      {label}
    </div>
  );
}

export function HostJourneyDiagram() {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/25 p-3">
      <div className="grid grid-cols-2 gap-2 text-center md:grid-cols-3">
        <Node label="1. Sign In" tone="blue" />
        <Node label="2. Create Room" tone="blue" />
        <Node label="3. Pick Source" tone="blue" />
        <Node label="4. Share Code" tone="blue" />
        <Node label="5. Go Live" tone="blue" />
        <Node label="6. Pause/Stop" tone="blue" />
      </div>
      <div className="mt-3 flex items-center justify-center gap-2 text-[11px] text-blue-200/90">
        <span className="h-2 w-2 rounded-full bg-blue-300 animate-pulse" />
        <span>Live host flow rendered instantly</span>
      </div>
    </div>
  );
}

export function ListenerJourneyDiagram() {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/25 p-3">
      <div className="grid grid-cols-2 gap-2 text-center md:grid-cols-3">
        <Node label="1. Open Invite" tone="emerald" />
        <Node label="2. Sign In" tone="emerald" />
        <Node label="3. Start Listening" tone="emerald" />
        <Node label="4. Tap to Hear" tone="emerald" />
        <Node label="5. Set Volume" tone="emerald" />
        <Node label="6. React & Leave" tone="emerald" />
      </div>
      <div className="mt-3 flex items-center justify-center gap-2 text-[11px] text-emerald-200/90">
        <span className="h-2 w-2 rounded-full bg-emerald-300 animate-pulse" />
        <span>Fast local diagram, no image download</span>
      </div>
    </div>
  );
}
