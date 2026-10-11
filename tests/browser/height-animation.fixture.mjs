// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.

export async function holdHeightAnimations(locator) {
  await locator.evaluate(element => {
    const original = element.animate;
    const descriptor = Object.getOwnPropertyDescriptor(element, 'animate');
    element.__restoreHeightAnimationCapture = () => {
      if (descriptor) Object.defineProperty(element, 'animate', descriptor);
      else delete element.animate;
      for (const animation of element.getAnimations())
        if (animation.playbackRate === 0) animation.playbackRate = 1;
      delete element.__restoreHeightAnimationCapture;
    };
    element.animate = function (...args) {
      const animation = original.apply(this, args);
      // Capture the real animation synchronously, before a delayed test command
      // can miss it. Zero speed keeps its running state and completion handlers.
      if (animation.effect.getKeyframes().some(frame => 'height' in frame)) animation.playbackRate = 0;
      return animation;
    };
  });
  return () => locator.evaluate(element => element.__restoreHeightAnimationCapture?.());
}

export const seekHeightAnimation = (locator, progress) => locator.evaluate(async (element, fraction) => {
  const animation = element.getAnimations().find(item => item.effect.getKeyframes().some(frame => 'height' in frame));
  if (!animation) throw new Error('A real height animation must be active before seeking.');
  await animation.ready;
  const { delay, duration } = animation.effect.getTiming();
  if (!(Number(duration) > 0)) throw new Error('The height animation must have a positive duration.');
  animation.currentTime = delay + Number(duration) * fraction;
  await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
  const frames = animation.effect.getKeyframes();
  return { from: Number.parseFloat(frames[0].height), to: Number.parseFloat(frames.at(-1).height),
    height: element.getBoundingClientRect().height, running: animation.playState === 'running' };
}, progress);

export const finishHeightAnimations = locator => locator.evaluate(element => {
  for (const animation of element.getAnimations()) {
    animation.playbackRate = 1;
    animation.finish();
  }
});

export const resumeHeightAnimations = locator => locator.evaluate(element => {
  for (const animation of element.getAnimations()) animation.playbackRate = 1;
});
