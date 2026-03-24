import { Link } from 'react-router-dom';
import { ArrowRight, PlayCircle, PauseCircle, Square, QrCode, Copy, Users, ShieldCheck } from 'lucide-react';
import { GlowCard } from '../components/ui/spotlight-card';

const steps = [
  {
    title: 'Sign in with Google',
    body: 'Use the Sign In button to authenticate. This protects rooms and lets listeners see who is hosting.',
    tip: 'If account popup is blocked, allow popups and try again.',
    icon: ShieldCheck,
  },
  {
    title: 'Create a room from home',
    body: 'Click Create Room. HearTogether generates a unique room code instantly.',
    tip: 'Keep this page open while hosting.',
    icon: PlayCircle,
  },
  {
    title: 'Pick your broadcast source',
    body: 'Choose System Audio for tab/screen audio or Microphone for voice-only sessions.',
    tip: 'For tab music/video, select the tab and enable browser Share audio.',
    icon: PlayCircle,
  },
  {
    title: 'Invite listeners quickly',
    body: 'Share room code, copied link, or let listeners scan the QR code.',
    tip: 'QR works best when projected on a second screen.',
    icon: QrCode,
  },
  {
    title: 'Manage live stream controls',
    body: 'Use Pause to temporarily mute output and Resume to continue. Use Stop when session ends.',
    tip: 'Stop also disconnects everyone cleanly and closes active share.',
    icon: PauseCircle,
  },
  {
    title: 'Monitor audience status',
    body: 'Watch listener list and reactions in real time. Remove a listener if needed.',
    tip: 'This helps moderate large sessions.',
    icon: Users,
  },
];

export default function HostManualPage() {
  return (
    <div className="min-h-screen px-4 py-8 md:px-10">
      <div className="mx-auto max-w-6xl">
        <div className="mb-5 flex flex-wrap items-center gap-3">
          <Link
            to="/manual"
            className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-black/20 px-3 py-1.5 text-sm font-medium text-gray-300 transition hover:border-brand-400/60 hover:text-white"
          >
            <ArrowRight className="h-4 w-4 rotate-180" />
            Back to Manual
          </Link>
          <Link
            to="/"
            className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-black/20 px-3 py-1.5 text-sm font-medium text-gray-300 transition hover:border-brand-400/60 hover:text-white"
          >
            Home
          </Link>
        </div>

        <section className="mb-8 overflow-hidden rounded-3xl border border-blue-400/30 bg-gradient-to-br from-blue-500/20 via-sky-500/10 to-cyan-400/10">
          <div className="grid gap-4 p-6 md:grid-cols-[1.3fr_1fr] md:p-8">
            <div>
              <p className="mb-3 inline-flex items-center gap-2 rounded-full bg-blue-400/20 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-blue-200">
                Host Walkthrough
              </p>
              <h1 className="text-3xl font-extrabold md:text-4xl">Run your first room with confidence</h1>
              <p className="mt-3 text-sm text-gray-300 md:text-base">
                Follow these steps in order once. After that, hosting takes less than a minute.
              </p>
            </div>
            <img
              src="/manual/host-flow.svg"
              alt="Host journey diagram"
              className="w-full rounded-2xl border border-white/10 bg-black/20"
              loading="lazy"
            />
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-2">
          {steps.map((step, idx) => {
            const Icon = step.icon;
            return (
              <GlowCard key={step.title} customSize glowColor="blue" className="w-full">
                <div className="flex items-start gap-3">
                  <div className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-blue-400/30 bg-blue-500/15">
                    <Icon className="h-5 w-5 text-blue-300" />
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-blue-200">Step {idx + 1}</p>
                    <h2 className="mt-1 text-lg font-bold">{step.title}</h2>
                    <p className="mt-2 text-sm text-gray-300">{step.body}</p>
                    <p className="mt-3 rounded-lg border border-blue-300/20 bg-blue-500/10 px-3 py-2 text-xs text-blue-100">
                      Tip: {step.tip}
                    </p>
                  </div>
                </div>
              </GlowCard>
            );
          })}
        </section>

        <section className="mt-8 rounded-2xl border border-white/10 bg-black/20 p-5">
          <h3 className="text-lg font-bold">Quick checklist before you go live</h3>
          <div className="mt-4 grid gap-2 text-sm text-gray-300 md:grid-cols-2">
            <p className="inline-flex items-center gap-2"><Copy className="h-4 w-4 text-brand-300" /> Room link copied</p>
            <p className="inline-flex items-center gap-2"><QrCode className="h-4 w-4 text-brand-300" /> QR visible to listeners</p>
            <p className="inline-flex items-center gap-2"><PlayCircle className="h-4 w-4 text-brand-300" /> Audio source selected</p>
            <p className="inline-flex items-center gap-2"><Square className="h-4 w-4 text-brand-300" /> Stop when session ends</p>
          </div>
        </section>
      </div>
    </div>
  );
}
