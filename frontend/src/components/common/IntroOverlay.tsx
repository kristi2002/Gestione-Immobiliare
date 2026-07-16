import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';

const FALLBACK_TIMEOUT_MS = 5000;

/**
 * Full-screen splash video shown on first paint. Fades out when the video
 * ends, when the fallback timer fires (covers blocked autoplay), or when
 * the user clicks "Salta intro".
 */
export function IntroOverlay() {
  const [visible, setVisible] = useState(true);
  const videoRef = useRef<HTMLVideoElement>(null);

  const dismiss = useCallback(() => setVisible(false), []);

  useEffect(() => {
    const timer = window.setTimeout(dismiss, FALLBACK_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [dismiss]);

  // Lock page scroll while the intro is covering the app.
  useEffect(() => {
    if (!visible) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [visible]);

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key="intro-overlay"
          initial={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.8, ease: [0.4, 0, 0.2, 1] } }}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: '#000',
            willChange: 'opacity',
          }}
        >
          <video
            ref={videoRef}
            src="/intro.mp4"
            autoPlay
            muted
            playsInline
            preload="auto"
            onEnded={dismiss}
            onError={dismiss}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              willChange: 'transform',
            }}
          />

          <motion.button
            type="button"
            onClick={dismiss}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0, transition: { delay: 0.6, duration: 0.4 } }}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.96 }}
            style={{
              position: 'absolute',
              bottom: '2.5rem',
              right: '2.5rem',
              padding: '0.6rem 1.4rem',
              borderRadius: '9999px',
              border: '1px solid rgba(255, 255, 255, 0.35)',
              background: 'rgba(0, 0, 0, 0.45)',
              backdropFilter: 'blur(8px)',
              color: '#fff',
              fontSize: '0.875rem',
              letterSpacing: '0.05em',
              cursor: 'pointer',
            }}
            aria-label="Salta intro"
          >
            Salta intro
          </motion.button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
