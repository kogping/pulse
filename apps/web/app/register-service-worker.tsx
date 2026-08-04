"use client";

import { useEffect } from "react";

// Registers the app-shell-only service worker (public/sw.js). Deliberately
// a tiny client component rather than inline layout script, so it can be
// unit-tested and so it never blocks the initial render.
export function RegisterServiceWorker() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js");
  }, []);

  return null;
}
