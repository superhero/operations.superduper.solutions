// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// Keep the optional capture/recovery graph outside the single-file application.
export function loadContinuous(){
  if(import.meta.env.DEV)return import('./continuous-controller.js');
  return import(/* @vite-ignore */new URL('speech/continuous-controller.js',document.baseURI).href);
}
