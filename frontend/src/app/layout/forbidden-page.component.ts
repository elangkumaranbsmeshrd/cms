import { Component, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';

@Component({
  selector: 'app-forbidden-page',
  standalone: true,
  template: `
    <div class="empty" style="padding: 60px 16px;">
      <div class="ico">🔒</div>
      <p><b>You don't have access to this screen.</b></p>
      @if (screen()) {
        <p class="hint">{{ screen() }}</p>
      }
    </div>
  `,
})
export class ForbiddenPageComponent {
  private readonly route = inject(ActivatedRoute);
  readonly screen = () => this.route.snapshot.queryParamMap.get('screen');
}
