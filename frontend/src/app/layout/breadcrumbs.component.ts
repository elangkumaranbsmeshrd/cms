import { Component, computed, inject } from '@angular/core';
import { Router } from '@angular/router';

import { BreadcrumbService } from '../core/navigation/breadcrumb.service';
import { DirtyStateService } from '../core/navigation/dirty-state.service';
import { NavigationHistoryService } from '../core/navigation/navigation-history.service';
import { IconComponent } from '../shared/ui/icon.component';

/** Back + breadcrumb trail, rendered ONCE in the topbar.
 *
 * Deliberately not per-screen-shape: putting it here means a screen physically
 * cannot forget it, and the ~150 screens still to be built inherit it without
 * knowing it exists. It also matches the prototype, whose own breadcrumb lives
 * in the topbar (index.html's .crumb).
 *
 * Back is hidden on a top-level nav destination — a module root has nowhere
 * above it to go, and a control that does nothing is a bug.
 */
@Component({
  selector: 'app-breadcrumbs',
  standalone: true,
  imports: [IconComponent],
  template: `
    @if (canGoBack()) {
      <button class="icon-btn" type="button" title="Back" aria-label="Back" (click)="back()">
        <app-icon name="arrow" [size]="15" />
      </button>
    }
    @if (trail().length) {
      <nav class="crumb" aria-label="Breadcrumb">
        @for (crumb of trail(); track $index) {
          @if ($index) {
            <span class="sep" aria-hidden="true">/</span>
          }
          @if (crumb.url) {
            <a (click)="go(crumb.url!)">{{ crumb.label }}</a>
          } @else {
            <span class="here" aria-current="page">{{ crumb.label }}</span>
          }
        }
      </nav>
    }
  `,
})
export class BreadcrumbsComponent {
  private readonly router = inject(Router);
  private readonly history = inject(NavigationHistoryService);
  private readonly dirty = inject(DirtyStateService);
  private readonly breadcrumbs = inject(BreadcrumbService);

  protected readonly trail = this.breadcrumbs.trail;

  /** Anything with an ancestor crumb is below a module root, so Back means
   * something. A bare "Module › Screen" trail is a top-level destination. */
  protected readonly canGoBack = computed(() => this.trail().some((c) => !!c.url));

  protected back(): void {
    if (!this.dirty.confirmLeave()) return;
    const origin = this.history.previous(this.router.url);
    if (origin) {
      this.router.navigateByUrl(origin);
      return;
    }
    // Deep link, refresh, or arrival from a notification: no in-app origin
    // exists, so fall back to the nearest ancestor the trail knows about.
    // Never a dead end.
    const parents = this.trail().filter((c) => c.url);
    const nearest = parents[parents.length - 1]?.url;
    this.router.navigateByUrl(nearest ?? '/');
  }

  protected go(url: string): void {
    if (!this.dirty.confirmLeave()) return;
    this.router.navigateByUrl(url);
  }
}
