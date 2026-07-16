import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { motion, AnimatePresence } from 'framer-motion';
import * as THREE from 'three';
import { HouseScene } from './HouseScene';
import { DOOR_THRESHOLD_Z, FLIGHT_DURATION, easeFlight, sampleFlight } from './cameraPath';

/**
 * CinematicIntro — full-screen 3D "arrival" sequence shown once per session
 * after login. The camera flies from a wide beach-side hero shot, arcs to the
 * front door and passes through it; crossing the threshold fades the canvas
 * out and reveals the app underneath.
 *
 * Usage: render as an overlay *above* the app shell (see IntroGate).
 */

import { markIntroSeen } from './introSession';

const _smoothedTarget = new THREE.Vector3(0, 1.6, 0);

/**
 * Drives the camera along the spline. Progress advances by real delta time
 * (frame-rate independent) and both position and look-target are additionally
 * run through critically-damped smoothing so the motion has physical weight
 * rather than raw linear coordinates.
 */
function CameraRig({ started, onEnter }: { started: boolean; onEnter: () => void }) {
  const camera = useThree((s) => s.camera);
  const progress = useRef(0);
  const entered = useRef(false);

  // Prime the camera on the first point of the path before the first paint.
  useEffect(() => {
    const { position, target } = sampleFlight(0);
    camera.position.copy(position);
    _smoothedTarget.copy(target);
    camera.lookAt(_smoothedTarget);
  }, [camera]);

  useFrame((_, delta) => {
    if (!started || entered.current) return;

    // Clamp delta so a background-tab hitch can't teleport the camera.
    progress.current = Math.min(progress.current + Math.min(delta, 0.05) / FLIGHT_DURATION, 1);
    const eased = easeFlight(progress.current);
    const { position, target } = sampleFlight(eased);

    // Damped follow: λ≈6 gives a soft, weighted trail behind the spline.
    const k = 1 - Math.exp(-6 * delta);
    camera.position.lerp(position, k);
    _smoothedTarget.lerp(target, k);
    camera.lookAt(_smoothedTarget);

    // Crossing the door plane (or exhausting the path) = "entered".
    if (camera.position.z <= DOOR_THRESHOLD_Z || progress.current >= 1) {
      entered.current = true;
      onEnter();
    }
  });

  return null;
}

/** Flips `onReady` once the Suspense subtree has actually mounted. */
function SceneReady({ onReady }: { onReady: () => void }) {
  useEffect(() => onReady(), [onReady]);
  return null;
}

export function CinematicIntro({ onComplete }: { onComplete: () => void }) {
  const [ready, setReady] = useState(false); // 3D assets mounted, flight may start
  const [leaving, setLeaving] = useState(false); // fade-out running

  const finish = useCallback(() => {
    setLeaving((prev) => {
      if (!prev) markIntroSeen();
      return true;
    });
  }, []);

  // Accessibility: honor reduced-motion by skipping the flight entirely,
  // and allow Escape as a keyboard skip. Listener cleaned up on unmount.
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      finish();
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Enter') finish();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [finish]);

  const handleReady = useCallback(() => setReady(true), []);

  return (
    <AnimatePresence onExitComplete={onComplete}>
      {!leaving && (
        <motion.div
          key="intro"
          className="fixed inset-0 z-[100] bg-[#0b1420]"
          initial={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 1.1, ease: [0.4, 0, 0.2, 1] } }}
          aria-label="Sequenza di introduzione cinematografica"
        >
          {/* Unmounting the Canvas on exit-complete disposes the WebGL
              context and the frame loop (handled by R3F). */}
          <Canvas
            shadows
            dpr={[1, 2]}
            gl={{ antialias: true, powerPreference: 'high-performance' }}
            camera={{ fov: 42, near: 0.1, far: 400 }}
            className="!absolute inset-0"
          >
            <Suspense fallback={null}>
              <HouseScene />
              <SceneReady onReady={handleReady} />
            </Suspense>
            <CameraRig started={ready} onEnter={finish} />
          </Canvas>

          {/* Cinematic letterbox bars */}
          <div className="pointer-events-none absolute inset-x-0 top-0 h-[6vh] bg-black/80" />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[6vh] bg-black/80" />

          {/* Title card */}
          <motion.div
            className="pointer-events-none absolute inset-x-0 top-[14vh] text-center"
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: ready ? 1 : 0, y: ready ? 0 : 24 }}
            transition={{ duration: 1.4, delay: 0.4, ease: 'easeOut' }}
          >
            <p className="text-xs uppercase tracking-[0.5em] text-white/70">Benvenuto in</p>
            <h1 className="mt-3 font-serif text-4xl font-light tracking-wide text-white drop-shadow-lg md:text-6xl">
              Immobiliare Orlandi
            </h1>
          </motion.div>

          {/* Loading state while the scene suspends */}
          {!ready && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="h-10 w-10 animate-spin rounded-full border-2 border-white/20 border-t-white/80" />
            </div>
          )}

          {/* Skip — magnetic-feel micro-interaction, no layout shift */}
          <motion.button
            type="button"
            onClick={finish}
            className="absolute bottom-[9vh] right-8 rounded-full border border-white/30 bg-white/10 px-5 py-2 text-sm tracking-widest text-white backdrop-blur-md transition-colors hover:bg-white/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.8, duration: 0.6 }}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.96 }}
          >
            Salta intro ↵
          </motion.button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
