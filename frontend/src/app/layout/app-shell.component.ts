import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';

import { AuthService } from '../core/auth/auth.service';
import { SessionStore } from '../core/auth/session.store';
import { UiStore } from '../core/ui/ui.store';
import { SidebarComponent } from './sidebar.component';
import { TopbarComponent } from './topbar.component';

/**
 * The preview banner below is a spec MUST, not decoration.
 *
 * APPENDIX-A-approved-decisions.md A112 approves building RBAC §4.2's "Preview
 * as this role" — and attaches a condition to that approval: it "MUST be
 * unmistakably marked as preview mode (persistent banner or border)".
 * APPENDIX-B-business-rules.md:156 repeats the requirement in the same words.
 * The feature shipped; the marking did not. The only indication a Super Admin
 * was previewing was a small pill in the topbar reading "Previewing", styled
 * identically to the passive "Viewing as" label it replaces.
 *
 * That matters because preview genuinely changes server-side authority — the
 * X-Preview-Role header is honoured by require_screen, so screens really do
 * disappear and rows really do vanish from lists. A Super Admin who forgets
 * they are previewing sees an application that appears to be broken: records
 * missing, actions gone, exports empty. The banner exists so that state is
 * never mistakable for a fault.
 *
 * Worth recording alongside this, because a stale spec note claims otherwise:
 * preview can only ever NARROW, and only for a caller whose JWT role is
 * genuinely SUPER_ADMIN (backend/app/rbac/deps.py checks the real role before
 * resolver.py consults the previewed one). A non-Super-Admin sending the header
 * gets byte-identical responses to not sending it — verified live against all
 * five roles. It is not impersonation and it is not an escalation path.
 */
@Component({
  selector: 'app-shell',
  standalone: true,
  imports: [RouterOutlet, SidebarComponent, TopbarComponent],
  template: `
    <div class="app" [class.collapsed]="ui.sidebarCollapsed()" [class.previewing]="session.previewingAs()">
      @if (session.previewingAs(); as previewedRole) {
        <div class="preview-banner" role="status">
          <span class="preview-dot" aria-hidden="true"></span>
          <span>
            Previewing as <b>{{ previewedRole }}</b> — screens and data are limited to what that role can
            see. This is not your own access.
          </span>
          <button class="preview-exit" type="button" (click)="exitPreview()">Exit preview</button>
        </div>
      }
      <app-topbar />
      <div class="body">
        <app-sidebar />
        <main class="canvas">
          <div class="canvas-inner">
            <router-outlet />
          </div>
        </main>
      </div>
    </div>
  `,
  // Scoped to this component rather than added to the global sheet: these
  // rules exist only for this banner, and every colour comes from the shared
  // warning ramp in styles/tokens.css, so both themes are handled by the
  // tokens themselves rather than by a second set of overrides here.
  styles: [
    `
      .preview-banner {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 9px 16px;
        background: var(--warning-bg);
        color: var(--warning);
        border-bottom: 1px solid var(--warning-line);
        font-size: 12.5px;
        line-height: 1.4;
        /* Above the topbar in the flow, so it cannot be scrolled out of sight
           — "persistent" is the part of the requirement that matters. */
        flex: 0 0 auto;
      }

      .preview-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: var(--warning);
        flex: 0 0 auto;
      }

      .preview-exit {
        margin-left: auto;
        flex: 0 0 auto;
        padding: 4px 12px;
        font: inherit;
        font-weight: 600;
        color: var(--warning);
        background: transparent;
        border: 1px solid var(--warning-line);
        border-radius: 6px;
        cursor: pointer;
      }

      .preview-exit:hover {
        background: var(--warning-line);
      }

      /* The second form the spec allows, applied together with the banner:
         a border around the shell, so the mode is unmistakable even when the
         banner is off-screen on a short viewport. */
      .app.previewing {
        box-shadow: inset 0 0 0 2px var(--warning-line);
      }
    `,
  ],
})
export class AppShellComponent {
  readonly ui = inject(UiStore);
  readonly session = inject(SessionStore);
  private readonly auth = inject(AuthService);

  protected exitPreview(): void {
    this.auth.exitPreview().subscribe();
  }
}
