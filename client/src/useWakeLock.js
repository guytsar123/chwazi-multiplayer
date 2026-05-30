import { useEffect, useRef } from "react";

// Keeps the screen awake while `active` is true (best-effort; not supported
// everywhere, notably older iOS Safari — fails silently there).
export function useWakeLock(active) {
  const lockRef = useRef(null);

  useEffect(() => {
    let cancelled = false;

    async function request() {
      try {
        if (active && "wakeLock" in navigator) {
          lockRef.current = await navigator.wakeLock.request("screen");
        }
      } catch {
        /* ignore — non-critical */
      }
    }

    async function release() {
      try {
        if (lockRef.current) {
          await lockRef.current.release();
          lockRef.current = null;
        }
      } catch {
        /* ignore */
      }
    }

    if (active) {
      request();
      const onVisible = () => {
        if (!cancelled && document.visibilityState === "visible") request();
      };
      document.addEventListener("visibilitychange", onVisible);
      return () => {
        cancelled = true;
        document.removeEventListener("visibilitychange", onVisible);
        release();
      };
    } else {
      release();
    }
  }, [active]);
}
