// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.

export type MetricCandle = { open: number; high: number; low: number; close: number; count: number };
export type MetricsBar = { start: number; end: number; metrics: Record<string, MetricCandle> };
export type MetricsSample = { timestamp: number; values: Record<string, number> };

export const metricsMinuteDuration = 60_000;
export const metricsBarDuration = 15 * metricsMinuteDuration;

function bucket(timestamp: number, duration: number): MetricsBar
{
  const start = Math.floor(timestamp / duration) * duration;
  return { start, end: start + duration, metrics: Object.create(null) as Record<string, MetricCandle> };
}

function copy(bar: MetricsBar): MetricsBar
{
  return { ...bar, metrics: Object.fromEntries(Object.entries(bar.metrics).map(([name, candle]) => [name, { ...candle }])) };
}

function merge(target: MetricsBar, source: MetricsBar): void
{
  for (const [name, candle] of Object.entries(source.metrics))
  {
    const previous = Object.hasOwn(target.metrics, name) ? target.metrics[name] : undefined;
    Object.defineProperty(target.metrics, name, { value: previous ? {
      open: previous.open, high: Math.max(previous.high, candle.high), low: Math.min(previous.low, candle.low),
      close: candle.close, count: previous.count + candle.count,
    } : { ...candle }, enumerable: true, configurable: true, writable: true });
  }
}

/** Samples live only in the current minute; closed minutes feed one current 15-minute bar. */
export class MetricsAggregator
{
  private minute: MetricsBar | null = null;
  private quarter: MetricsBar | null = null;
  private latest = -Infinity;
  private closedThrough = -Infinity;

  constructor(initial?: MetricsBar | null, observedAt?: number)
  {
    if (!initial) return;
    this.quarter = copy(initial);
    this.closedThrough = initial.start;
    this.latest = observedAt !== undefined && Number.isSafeInteger(observedAt) && observedAt >= initial.start && observedAt < initial.end
      ? observedAt : initial.start;
  }

  add(sample: MetricsSample): MetricsBar[]
  {
    const timestamp = sample.timestamp;
    if (!Number.isSafeInteger(timestamp) || timestamp < this.latest || timestamp < this.closedThrough) return [];
    const completed = this.flush(timestamp);
    const values = Object.entries(sample.values).filter(([, value]) => Number.isFinite(value));
    if (!values.length) return completed;
    this.latest = timestamp;
    this.minute ??= bucket(timestamp, metricsMinuteDuration);
    for (const [name, value] of values)
    {
      const candle = this.minute.metrics[name];
      if (candle)
      {
        candle.high = Math.max(candle.high, value);
        candle.low = Math.min(candle.low, value);
        candle.close = value;
        candle.count++;
      }
      else this.minute.metrics[name] = { open: value, high: value, low: value, close: value, count: 1 };
    }
    return completed;
  }

  flush(now: number): MetricsBar[]
  {
    if (!Number.isSafeInteger(now)) return [];
    if (this.minute && this.minute.end <= now)
    {
      this.quarter ??= bucket(this.minute.start, metricsBarDuration);
      merge(this.quarter, this.minute);
      this.closedThrough = this.minute.end;
      this.minute = null;
    }
    if (!this.quarter || this.quarter.end > now) return [];
    const completed = copy(this.quarter);
    this.closedThrough = this.quarter.end;
    this.quarter = null;
    return [completed];
  }

  /** A detached preview; the current minute is included once without finalizing it. */
  activeBar(): MetricsBar | null
  {
    if (!this.minute && !this.quarter) return null;
    const active = this.quarter ? copy(this.quarter) : bucket(this.minute!.start, metricsBarDuration);
    if (this.minute) merge(active, this.minute);
    return copy(active);
  }
}
