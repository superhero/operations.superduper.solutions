// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.

/**
 * Vitest's logger exits one millisecond after an OS signal, before its public
 * cancellation API can finish worker cleanup. Defer only that pinned handler;
 * ordinary cancellation, reporting, terminal cleanup and pool disposal remain
 * Vitest-owned. Remove this compatibility shim when upstream handles signals
 * through graceful cancellation itself.
 */

const pinnedLoggerExit = '(signal,exitCode)=>{cleanup();if(process.exitCode===void0)'
  + 'process.exitCode=exitCode!==void0?128+exitCode:Number(signal);'
  + 'setTimeout(()=>process.exit(),1);}';

function deferPinnedLoggerSignalExit(vitest) {
  // Guard both the pinned implementation and shared callback identity. Never
  // remove a different tool's signal listener or silently skip this contract.
  const signatures = process.listeners('SIGINT').filter(listener => listener.name === 'onExit'
    && process.listeners('SIGTERM').includes(listener)
    && process.listeners('exit').includes(listener)
    && Function.prototype.toString.call(listener).replace(/\/\/[^\n]*/g, '').replace(/\s+/g, '') === pinnedLoggerExit);
  if (vitest.version !== '5.0.5' || signatures.length !== 1) {
    throw new Error('Vitest signal cleanup compatibility changed; verify graceful interruption before updating its pinned shim.');
  }
  process.off('SIGINT', signatures[0]);
  process.off('SIGTERM', signatures[0]);
  // Its exit callback remains registered for terminal cleanup. Vitest's normal
  // onClose callback still removes it, together with its remaining listeners.
}

export default class InterruptReporter {
  constructor({ shutdownTimeout = 15000 } = {}) {
    if (!Number.isSafeInteger(shutdownTimeout) || shutdownTimeout < 1) {
      throw new TypeError('Interrupt shutdownTimeout must be a positive number of milliseconds.');
    }
    this.shutdownTimeout = shutdownTimeout;
  }

  onInit(vitest) {
    deferPinnedLoggerSignalExit(vitest);
    this.vitest = vitest;
    this.exitCode = undefined;
    this.timer = undefined;
    let forcing = false;
    const force = () => {
      if (forcing) return;
      forcing = true;
      process.exitCode = this.exitCode;
      vitest.logger.warn('Test cancellation did not settle; forcing worker termination.');
      // A second cancellation escalates the in-flight pool cancellation and
      // terminates workers. exit(true) alone still awaits the running promise.
      // Vitest owns that shutdown; incomplete work cannot become passing proof.
      void vitest.cancelCurrentRun('keyboard-input').then(() => vitest.exit(true)).catch(error => {
        console.error(`Cannot finish test-run shutdown: ${error.message}`);
        process.exitCode = this.exitCode;
      });
    };
    const interrupt = signal => {
      if (this.exitCode !== undefined) { force(); return; }
      this.exitCode = signal === 'SIGTERM' ? 143 : 130;
      process.exitCode = this.exitCode;
      this.timer = setTimeout(force, this.shutdownTimeout);
      this.timer.unref();
      // The run promise still owns report generation and normal project close.
      // Awaiting it from an onTestRunEnd hook would create a deadlock.
      void vitest.cancelCurrentRun('keyboard-input').catch(error => {
        console.error(`Cannot cancel the test run cleanly: ${error.message}`);
        force();
      });
    };
    this.onInterrupt = () => interrupt('SIGINT');
    this.onTerminate = () => interrupt('SIGTERM');
    process.on('SIGINT', this.onInterrupt);
    process.on('SIGTERM', this.onTerminate);
    vitest.onClose(() => {
      clearTimeout(this.timer);
      process.off('SIGINT', this.onInterrupt);
      process.off('SIGTERM', this.onTerminate);
      if (this.exitCode !== undefined) process.exitCode = this.exitCode;
    });
  }

  onTestRunEnd() {
    if (this.exitCode !== undefined) process.exitCode = this.exitCode;
  }
}
