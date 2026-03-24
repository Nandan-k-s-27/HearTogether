import { Link } from 'react-router-dom';
import { Radio, Mic2, Headphones, ArrowRight } from 'lucide-react';
import { GlowCard } from '../components/ui/spotlight-card';

const cards = [
  {
    title: 'Host Manual',
    to: '/manual/host',
    icon: Radio,
    glowColor: 'blue',
    points: [
      'Create and manage a room in seconds',
      'Choose System Audio or Microphone broadcast',
      'Share room access using code, link, or QR',
    ],
  },
  {
    title: 'Listener Manual',
    to: '/manual/listener',
    icon: Headphones,
    glowColor: 'green',
    points: [
      'Join from room link or invite code',
      'Tap to hear and control your own volume',
      'Use quick reactions during live sessions',
    ],
  },
];

export default function UserManualPage() {
  return (
    <div className="min-h-screen px-4 py-8 md:px-10">
      <header className="mx-auto mb-10 max-w-5xl">
        <Link
          to="/"
          className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-black/20 px-3 py-1.5 text-sm font-medium text-gray-300 transition hover:border-brand-400/60 hover:text-white"
        >
          <ArrowRight className="h-4 w-4 rotate-180" />
          Back to Home
        </Link>

        <div className="mt-6 rounded-2xl border border-brand-400/20 bg-gradient-to-br from-brand-600/20 via-sky-500/10 to-teal-400/10 p-6 md:p-8">
          <p className="mb-2 inline-flex items-center gap-2 rounded-full bg-black/20 px-3 py-1 text-xs uppercase tracking-wider text-brand-200">
            <Mic2 className="h-3.5 w-3.5" />
            HearTogether Guide
          </p>
          <h1 className="text-3xl font-extrabold md:text-4xl">Choose your walkthrough</h1>
          <p className="mt-3 max-w-3xl text-sm text-gray-300 md:text-base">
            New users can start here. Pick the role you play, then follow visual steps to complete your first live session without confusion.
          </p>
        </div>
      </header>

      <main className="mx-auto grid max-w-5xl gap-6 md:grid-cols-2">
        {cards.map((card) => {
          const Icon = card.icon;
          return (
            <GlowCard key={card.title} customSize glowColor={card.glowColor} className="w-full">
              <div className="flex h-full flex-col">
                <div className="mb-4 inline-flex h-11 w-11 items-center justify-center rounded-xl border border-white/10 bg-black/20">
                  <Icon className="h-5 w-5 text-brand-300" />
                </div>
                <h2 className="text-xl font-bold">{card.title}</h2>
                <ul className="mt-4 space-y-2 text-sm text-gray-300">
                  {card.points.map((point) => (
                    <li key={point} className="flex items-start gap-2">
                      <span className="mt-1 h-1.5 w-1.5 rounded-full bg-brand-400" />
                      <span>{point}</span>
                    </li>
                  ))}
                </ul>

                <Link
                  to={card.to}
                  className="mt-6 inline-flex w-fit items-center gap-2 rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-500"
                >
                  Open {card.title}
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
            </GlowCard>
          );
        })}
      </main>
    </div>
  );
}
