"use client";

import { useSyncExternalStore } from "react";

function subscribe() {
  return () => {};
}

function clientSnapshot() {
  return true;
}

function serverSnapshot() {
  return false;
}

/**
 * Keeps security-sensitive controls disabled in server-rendered HTML and during
 * hydration, then enables them as soon as their client event handlers exist.
 */
export function useClientReady() {
  return useSyncExternalStore(subscribe, clientSnapshot, serverSnapshot);
}
