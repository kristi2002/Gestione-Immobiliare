import { Suspense, lazy, useState, type ReactNode } from 'react';
import { hasSeenIntro } from './introSession';

// Lazy so three.js / R3F / drei land in their own chunk and are only fetched
// when the intro is actually going to play.
const CinematicIntro = lazy(() =>
  import('./CinematicIntro').then((m) => ({ default: m.CinematicIntro })),
);

/**
 * Shows the cinematic 3D arrival sequence once per browser session, layered
 * over the app. The app renders underneath from the start, so when the camera
 * crosses the front door the canvas fades away and the dashboard is already
 * there — no double loading flash.
 */
export function IntroGate({ children }: { children: ReactNode }) {
  const [playing, setPlaying] = useState(() => !hasSeenIntro());

  return (
    <>
      {children}
      {playing && (
        <Suspense fallback={<div className="fixed inset-0 z-[100] bg-[#0b1420]" />}>
          <CinematicIntro onComplete={() => setPlaying(false)} />
        </Suspense>
      )}
    </>
  );
}
