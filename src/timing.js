export const timing = {
  cycle: 8,
  fillSecs: 6,
  fwdDelay: 1,
  fwdDur: 3,
  fwdHold: 0.5,
  upDelay: 4.5,
  upDur: 2.5,
  spinDelay: 4.5,
  spinAccel: 0.4,
};

// DISC_W = 0.7 — grid reaches cylinder junction at uProgress = 0.7
// We guarantee:  0.7 * fillSecs  <  upDelay
export function initTiming(duration, events) {
  const d      = duration;
  const onset  = events?.onset ?? d * 0.05;
  const peak   = events?.peak  ?? d * 0.30;

  timing.cycle    = d;
  timing.fillSecs = d * 0.45;

  // Camera rises after grid clears the disc-cylinder junction
  const cylinderTime = timing.fillSecs * 0.70;
  timing.upDelay  = cylinderTime + d * 0.025;
  timing.upDur    = d * 0.14;

  // Forward push ends just before up begins
  timing.fwdHold  = d * 0.03;
  timing.fwdDur   = Math.min((peak - onset) * 0.55, d * 0.18);
  timing.fwdDelay = Math.max(onset, timing.upDelay - timing.fwdHold - timing.fwdDur);

  timing.spinDelay = Math.max(0, timing.upDelay - d * 0.03);

  // spinAccel tuned so total spin ≈ 40 rad by end of cycle
  const spinDur    = d - timing.spinDelay;
  timing.spinAccel = spinDur > 0 ? 40 / spinDur ** 3 : 0.4;
}
