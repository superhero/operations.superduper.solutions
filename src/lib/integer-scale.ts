// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.

export type IntegerBounds = { minimum?: number | undefined; maximum?: number | undefined };
export type IntegerScale = {
  minimum: number;
  maximum: number;
  empty: boolean;
  position: (value: number) => number;
  value: (position: number) => number | undefined;
};

const lowest = Number.MIN_SAFE_INTEGER;
const highest = Number.MAX_SAFE_INTEGER;
const clamp = (value: number, minimum: number, maximum: number) => Math.min(maximum, Math.max(minimum, value));
const signedLog = (value: number) => Math.sign(value) * Math.log1p(Math.abs(value));
const signedExp = (value: number) => Math.sign(value) * Math.expm1(Math.abs(value));

export function createIntegerScale(bounds: IntegerBounds = {}): IntegerScale
{
  const lower = Math.ceil(bounds.minimum === undefined || Number.isNaN(bounds.minimum) ? lowest : bounds.minimum);
  const upper = Math.floor(bounds.maximum === undefined || Number.isNaN(bounds.maximum) ? highest : bounds.maximum);
  const minimum = clamp(lower, lowest, highest);
  const maximum = clamp(upper, lowest, highest);
  const empty = lower > upper || lower > highest || upper < lowest;
  const bounded = bounds.maximum !== undefined && !Number.isNaN(bounds.maximum);
  // Halving before addition keeps the midpoint safe across the entire signed domain.
  const middle = minimum / 2 + maximum / 2;
  const left = middle - minimum;
  const right = maximum - middle;
  const start = signedLog(minimum);
  const span = signedLog(maximum) - start;
  // Relative logarithms retain precision for narrow positive ranges near MAX_SAFE_INTEGER.
  const positiveSpan = minimum >= 0 ? Math.log1p((maximum - minimum) / (minimum + 1)) : 0;
  const integer = (value: number) => {
    const rounded = clamp(Math.round(value), minimum, maximum);
    return rounded === 0 ? 0 : rounded;
  };

  return {
    minimum, maximum, empty,
    position(value: number): number
    {
      if (empty || minimum === maximum) return 0.5;
      const current = integer(Number.isNaN(value) ? 0 : value);
      if (current === minimum) return 0;
      if (current === maximum) return 1;
      if (!bounded) return clamp(minimum >= 0
        ? Math.log1p((current - minimum) / (minimum + 1)) / positiveSpan
        : (signedLog(current) - start) / span, 0, 1);
      const distance = current - middle;
      const extent = distance < 0 ? left : right;
      return distance === 0 ? 0.5 : clamp(0.5 + Math.sign(distance) * Math.expm1(Math.abs(distance) / extent * Math.log1p(extent)) / extent / 2, 0, 1);
    },
    value(position: number): number | undefined
    {
      if (empty) return undefined;
      if (minimum === maximum) return minimum;
      const current = clamp(Number.isNaN(position) ? 0.5 : position, 0, 1);
      if (current === 0) return minimum;
      if (current === 1) return maximum;
      if (!bounded) return integer(minimum >= 0
        ? minimum + (minimum + 1) * Math.expm1(current * positiveSpan)
        : signedExp(start + current * span));
      // Values change fastest around the midpoint, slowing toward either end.
      const distance = current * 2 - 1;
      const extent = distance < 0 ? left : right;
      if (distance === 0 || extent === 0) return integer(middle);
      return integer(middle + Math.sign(distance) * extent * (Math.log1p(Math.abs(distance) * extent) / Math.log1p(extent)));
    }
  };
}
