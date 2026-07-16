const SESSION_KEY = 'orlandi_intro_seen';

/** Kept three.js-free so IntroGate can import it without pulling the 3D chunk. */
export function hasSeenIntro(): boolean {
  try {
    return sessionStorage.getItem(SESSION_KEY) === '1';
  } catch {
    return true; // storage unavailable → never trap the user in the intro
  }
}

export function markIntroSeen() {
  try {
    sessionStorage.setItem(SESSION_KEY, '1');
  } catch {
    /* non-fatal */
  }
}
