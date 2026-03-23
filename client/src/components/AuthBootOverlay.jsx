const BOOT_STEPS = [
  'Reserving compute',
  'Spinning secure containers',
  'Preparing sign-in gateway',
];

export default function AuthBootOverlay({ state }) {
  const attempt = Math.max(0, state?.attempt || 0);
  const activeStep = Math.min(BOOT_STEPS.length - 1, Math.floor(attempt / 2));

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/95 px-6 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-3xl border border-cyan-500/20 bg-slate-900/80 p-6 shadow-[0_0_90px_rgba(34,211,238,0.16)] sm:p-8">
        <div className="mb-5 flex items-center gap-3">
          <div className="h-3 w-3 rounded-full bg-cyan-400 animate-pulse" />
          <p className="text-xs uppercase tracking-[0.18em] text-cyan-300/80">HearTogether Startup</p>
        </div>

        <h2 className="text-2xl font-bold text-white sm:text-3xl">Waking the audio engine...</h2>
        <p className="mt-2 text-sm text-slate-300">{state?.message || 'Connecting to backend services.'}</p>

        <div className="mt-6 grid grid-cols-3 gap-3">
          {BOOT_STEPS.map((label, idx) => {
            const completed = idx < activeStep;
            const current = idx === activeStep;

            return (
              <div
                key={label}
                className={`rounded-xl border px-3 py-4 text-center transition ${
                  completed
                    ? 'border-emerald-400/50 bg-emerald-400/10 text-emerald-200'
                    : current
                    ? 'border-cyan-400/60 bg-cyan-400/10 text-cyan-100'
                    : 'border-slate-700 bg-slate-800/70 text-slate-400'
                }`}
              >
                <div className={`mx-auto mb-2 h-2 w-2 rounded-full ${current ? 'animate-ping bg-cyan-300' : completed ? 'bg-emerald-300' : 'bg-slate-500'}`} />
                <p className="text-[11px] leading-tight">{label}</p>
              </div>
            );
          })}
        </div>

        <div className="mt-6 h-2 overflow-hidden rounded-full bg-slate-800">
          <div className="h-full w-1/3 animate-[bootSweep_1.2s_ease-in-out_infinite] rounded-full bg-gradient-to-r from-cyan-400 via-sky-300 to-cyan-400" />
        </div>

        <p className="mt-3 text-xs text-slate-400">Attempt #{attempt || 1}. This usually takes 10-40 seconds when idle.</p>
      </div>
    </div>
  );
}