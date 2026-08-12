"use client";

import { useEffect } from "react";

// Registers the app-shell-only service worker (public/sw.js). Deliberately
// a tiny client component rather than inline layout script, so it can be
// unit-tested and so it never blocks the initial render.
export function RegisterServiceWorker() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").then((registration) => {
      // Browsers only auto-check a registered SW script for byte-level
      // changes at most once every 24h — an already-open tab (or one
      // reopened from a home-screen icon) would otherwise keep running
      // whatever service worker it installed with, for up to a day, no
      // matter how many times the app is redeployed in between. An
      // explicit update() check on every load closes that gap; combined
      // with sw.js's own skipWaiting()/clients.claim(), a real change
      // takes over on this load rather than the next new tab.
      void registration.update();
    });
  }, []);

  return null;
}
