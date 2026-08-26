import { Component, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';

import { SessionStore } from '../core/auth/session.store';

/** Placeholder for a screen the RBAC policy makes visible but that has no
 * built component yet — an honest "not built" state, not a broken link.
 * Every screen this role can see IS in the sidebar; most just land here
 * until their turn in the build order.
 */
@Component({
  selector: 'app-coming-soon',
  standalone: true,
  template: `
    <div class="page-head">
      <div>
        <h1 class="page-title">{{ label() }}</h1>
        <p class="page-sub">This screen's backend is live at 400+ other endpoints — this particular screen's frontend hasn't been built yet.</p>
      </div>
    </div>
    <div class="card">
      <div class="empty">
        <div class="ico">🚧</div>
        <p><b>Coming soon</b></p>
        <p class="hint">screen_key: {{ screenId() }}</p>
      </div>
    </div>
  `,
})
export class ComingSoonComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly session = inject(SessionStore);
  readonly screenId = () => this.route.snapshot.paramMap.get('id') ?? '';
  readonly label = () => this.session.policy().screens[this.screenId()]?.label ?? this.screenId();
}
