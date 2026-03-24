import { Link } from 'react-router-dom';
import { ArrowRight, Link2, LogIn, Headphones, Volume2, SmilePlus, DoorOpen } from 'lucide-react';
import { GlowCard } from '../components/ui/spotlight-card';

const steps = [
  {
    title: 'Open room invite',
    body: 'Use room link, QR code, or typed room code to open the Join page.',
    tip: 'If code is wrong, ask host to share it again.',
    icon: Link2,
  },
  {
    title: 'Sign in with Google',
    body: 'Sign in once so the host can identify who is connected.',
    tip: 'Your account details are shown only in the session context.',
    icon: LogIn,
  },
  {
    title: 'Start Listening',
    body: 'Press Start Listening to enter the live room and wait for host stream.',
    tip: 'Keep the screen active during first connection.',
    icon: Headphones,
  },
  {
    title: 'Tap to Hear audio',
    body: 'When the stream is ready, tap Tap to Hear to allow browser playback.',
    tip: 'This tap is required on many mobile browsers.',
    icon: Headphones,
  },
  {
    title: 'Adjust your own volume',
    body: 'Use the volume slider anytime without affecting other listeners.',
    tip: 'If audio is low, check both browser and device volume.',
    icon: Volume2,
  },
  {
    title: 'React and leave safely',
    body: 'Send emoji reactions during session and press Leave when done.',
    tip: 'If host stops broadcast, use Back to Home.',
    icon: SmilePlus,
  },
];

export default function ListenerManualPage() {
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

        <section className="mb-8 overflow-hidden rounded-3xl border border-emerald-400/30 bg-gradient-to-br from-emerald-500/20 via-teal-500/10 to-cyan-400/10">
          <div className="grid gap-4 p-6 md:grid-cols-[1.3fr_1fr] md:p-8">
            <div>
              <p className="mb-3 inline-flex items-center gap-2 rounded-full bg-emerald-400/20 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-emerald-200">
                Listener Walkthrough
              </p>
              <h1 className="text-3xl font-extrabold md:text-4xl">Join and listen in under one minute</h1>
              <p className="mt-3 text-sm text-gray-300 md:text-base">
                This guide is for first-time listeners who want a smooth connection and clean audio.
              </p>
            </div>
            <img
              src="/manual/listener-flow.svg"
              alt="Listener journey diagram"
              className="w-full rounded-2xl border border-white/10 bg-black/20"
              loading="lazy"
            />
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-2">
          {steps.map((step, idx) => {
            const Icon = step.icon;
            return (
              <GlowCard key={step.title} customSize glowColor="green" className="w-full">
                <div className="flex items-start gap-3">
                  <div className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-emerald-400/30 bg-emerald-500/15">
                    <Icon className="h-5 w-5 text-emerald-300" />
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-emerald-200">Step {idx + 1}</p>
                    <h2 className="mt-1 text-lg font-bold">{step.title}</h2>
                    <p className="mt-2 text-sm text-gray-300">{step.body}</p>
                    <p className="mt-3 rounded-lg border border-emerald-300/20 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-100">
                      Tip: {step.tip}
                    </p>
                  </div>
                </div>
              </GlowCard>
            );
          })}
        </section>

        <section className="mt-8 rounded-2xl border border-white/10 bg-black/20 p-5">
          <h3 className="text-lg font-bold">Troubleshooting in 20 seconds</h3>
          <div className="mt-4 grid gap-2 text-sm text-gray-300 md:grid-cols-2">
            <p className="inline-flex items-center gap-2"><Volume2 className="h-4 w-4 text-emerald-300" /> No sound: tap Tap to Hear again</p>
            <p className="inline-flex items-center gap-2"><Link2 className="h-4 w-4 text-emerald-300" /> Invalid room: verify latest code/link</p>
            <p className="inline-flex items-center gap-2"><Headphones className="h-4 w-4 text-emerald-300" /> Distortion: lower volume slider</p>
            <p className="inline-flex items-center gap-2"><DoorOpen className="h-4 w-4 text-emerald-300" /> Session ended: return Home and rejoin</p>
          </div>
        </section>
      </div>
    </div>
  );
}
