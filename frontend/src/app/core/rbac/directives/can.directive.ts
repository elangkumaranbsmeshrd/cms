import { Directive, Input, TemplateRef, ViewContainerRef, effect, inject, signal } from '@angular/core';

import { PolicyStore } from '../policy.store';

/**
 * Structural directive: `*cmsCan="[screenId, action]"`. Layer 2 (action
 * visibility) — ARCH-3 §4. Used sparingly; PageHeadComponent/DataTableComponent
 * filter their own ActionDef[] through PolicyStore.can() internally, so most
 * screens never reference this directly (mirrors the prototype's U.pageHead/
 * U.table doing the same filtering).
 */
@Directive({
  selector: '[cmsCan]',
  standalone: true,
})
export class CanDirective {
  private readonly policy = inject(PolicyStore);
  private readonly vcr = inject(ViewContainerRef);
  private readonly tpl = inject(TemplateRef<unknown>);
  private readonly spec = signal<[string, string] | null>(null);
  private hasView = false;

  @Input({ required: true })
  set cmsCan(value: [string, string]) {
    this.spec.set(value);
  }

  constructor() {
    effect(() => {
      const spec = this.spec();
      const allowed = !!spec && this.policy.can(spec[0], spec[1]);
      if (allowed && !this.hasView) {
        this.vcr.createEmbeddedView(this.tpl);
        this.hasView = true;
      } else if (!allowed && this.hasView) {
        this.vcr.clear();
        this.hasView = false;
      }
    });
  }
}
