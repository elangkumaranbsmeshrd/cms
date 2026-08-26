import { Injectable, signal } from '@angular/core';

/**
 * "Leaving a form or an in-progress record edit with unsaved changes prompts
 * before discarding."
 *
 * A screen with unsaved work registers a predicate here; anything that
 * navigates away (the Back control, a breadcrumb link) asks `confirmLeave()`
 * first. A predicate rather than a boolean flag so the answer is evaluated at
 * the moment of leaving — a form that has been saved, or reverted back to its
 * loaded values, is no longer dirty and must not nag.
 *
 * Registration is keyed so a screen replacing another cannot leave a stale
 * predicate behind, and `clear()` on destroy is belt-and-braces on top.
 */
@Injectable({ providedIn: 'root' })
export class DirtyStateService {
  private readonly guards = signal<Record<string, () => boolean>>({});

  register(key: string, isDirty: () => boolean): void {
    this.guards.update((g) => ({ ...g, [key]: isDirty }));
  }

  clear(key: string): void {
    this.guards.update((g) => {
      const next = { ...g };
      delete next[key];
      return next;
    });
  }

  isDirty(): boolean {
    return Object.values(this.guards()).some((fn) => {
      try {
        return fn();
      } catch {
        // A screen mid-teardown must never be able to trap the user.
        return false;
      }
    });
  }

  /** True = go ahead and leave. States the specific consequence, per the
   * house rule that a confirm never says "Are you sure?". */
  confirmLeave(): boolean {
    if (!this.isDirty()) return true;
    return window.confirm('You have unsaved changes on this screen. Leaving now discards them. Leave anyway?');
  }
}
