import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';

import { UiStore } from '../core/ui/ui.store';
import { SidebarComponent } from './sidebar.component';
import { TopbarComponent } from './topbar.component';

@Component({
  selector: 'app-shell',
  standalone: true,
  imports: [RouterOutlet, SidebarComponent, TopbarComponent],
  template: `
    <div class="app" [class.collapsed]="ui.sidebarCollapsed()">
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
})
export class AppShellComponent {
  readonly ui = inject(UiStore);
}
