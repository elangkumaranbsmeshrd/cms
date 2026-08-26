import { Component, input } from '@angular/core';

import { BoardScreenComponent } from './board-screen/board-screen.component';
import { CalendarScreenComponent } from './calendar-screen/calendar-screen.component';
import { ChecklistScreenComponent } from './checklist-screen/checklist-screen.component';
import { ConversationScreenComponent } from './conversation-screen/conversation-screen.component';
import { DashboardScreenComponent } from './dashboard-screen/dashboard-screen.component';
import { DocumentScreenComponent } from './document-screen/document-screen.component';
import { FormScreenComponent } from './form-screen/form-screen.component';
import { ListScreenComponent } from './list-screen/list-screen.component';
import { MatrixScreenComponent } from './matrix-screen/matrix-screen.component';
import { PayslipScreenComponent } from './payslip-screen/payslip-screen.component';
import { RecordScreenComponent } from './record-screen/record-screen.component';
import { ReportScreenComponent } from './report-screen/report-screen.component';
import { SingletonFormComponent } from './singleton-form/singleton-form.component';
import { TabbedScreenComponent } from './tabbed-screen/tabbed-screen.component';
import {
  BoardScreenConfig,
  CalendarScreenConfig,
  ChecklistScreenConfig,
  ConversationScreenConfig,
  DashboardScreenConfig,
  DocumentScreenConfig,
  FormScreenConfig,
  ListScreenConfig,
  MatrixScreenConfig,
  PayslipScreenConfig,
  RecordScreenConfig,
  ReportScreenConfig,
  ScreenConfig,
  SingletonFormConfig,
  TabbedScreenConfig,
} from './screen.types';

/** Resolves the route's lazy-loaded config and renders the matching shape
 * component. One host, N shapes — ARCH-3 §2's SHAPE_COMPONENT map. The
 * `listConfig`/`recordConfig`/`formConfig`/`singletonConfig` getters exist
 * purely for template type-narrowing — Angular's template checker doesn't
 * narrow a union type from a `@switch` on one of its members, so each
 * `@case` needs its own already-narrowed accessor.
 */
@Component({
  selector: 'app-screen-host',
  standalone: true,
  imports: [
    ListScreenComponent,
    RecordScreenComponent,
    FormScreenComponent,
    SingletonFormComponent,
    TabbedScreenComponent,
    BoardScreenComponent,
    ReportScreenComponent,
    CalendarScreenComponent,
    ChecklistScreenComponent,
    ConversationScreenComponent,
    DashboardScreenComponent,
    DocumentScreenComponent,
    PayslipScreenComponent,
    MatrixScreenComponent,
  ],
  template: `
    @switch (config().shape) {
      @case ('list') {
        <app-list-screen [config]="listConfig" />
      }
      @case ('record') {
        <app-record-screen [config]="recordConfig" />
      }
      @case ('form') {
        <app-form-screen [config]="formConfig" />
      }
      @case ('singleton') {
        <app-singleton-form [config]="singletonConfig" />
      }
      @case ('tabbed') {
        <app-tabbed-screen [config]="tabbedConfig" />
      }
      @case ('board') {
        <app-board-screen [config]="boardConfig" />
      }
      @case ('report') {
        <app-report-screen [config]="reportConfig" />
      }
      @case ('calendar') {
        <app-calendar-screen [config]="calendarConfig" />
      }
      @case ('checklist') {
        <app-checklist-screen [config]="checklistConfig" />
      }
      @case ('conversation') {
        <app-conversation-screen [config]="conversationConfig" />
      }
      @case ('dashboard') {
        <app-dashboard-screen [config]="dashboardConfig" />
      }
      @case ('document') {
        <app-document-screen [config]="documentConfig" />
      }
      @case ('payslip') {
        <app-payslip-screen [config]="payslipConfig" />
      }
      @case ('matrix') {
        <app-matrix-screen [config]="matrixConfig" />
      }
      @default {
        <p>Unknown screen shape: {{ config().shape }}</p>
      }
    }
  `,
})
export class ScreenHostComponent {
  // Bound from the route's resolved "config" data key via withComponentInputBinding().
  readonly config = input.required<ScreenConfig>();

  protected get listConfig(): ListScreenConfig<any> {
    return this.config() as ListScreenConfig<any>;
  }

  protected get recordConfig(): RecordScreenConfig<any> {
    return this.config() as RecordScreenConfig<any>;
  }

  protected get formConfig(): FormScreenConfig<any> {
    return this.config() as FormScreenConfig<any>;
  }

  protected get singletonConfig(): SingletonFormConfig<any> {
    return this.config() as SingletonFormConfig<any>;
  }

  protected get tabbedConfig(): TabbedScreenConfig<any> {
    return this.config() as TabbedScreenConfig<any>;
  }

  protected get boardConfig(): BoardScreenConfig<any> {
    return this.config() as BoardScreenConfig<any>;
  }

  protected get reportConfig(): ReportScreenConfig<any> {
    return this.config() as ReportScreenConfig<any>;
  }

  protected get calendarConfig(): CalendarScreenConfig<any> {
    return this.config() as CalendarScreenConfig<any>;
  }

  protected get checklistConfig(): ChecklistScreenConfig<any> {
    return this.config() as ChecklistScreenConfig<any>;
  }

  protected get conversationConfig(): ConversationScreenConfig<any> {
    return this.config() as ConversationScreenConfig<any>;
  }

  protected get dashboardConfig(): DashboardScreenConfig<any> {
    return this.config() as DashboardScreenConfig<any>;
  }

  protected get documentConfig(): DocumentScreenConfig<any> {
    return this.config() as DocumentScreenConfig<any>;
  }

  protected get payslipConfig(): PayslipScreenConfig<any> {
    return this.config() as PayslipScreenConfig<any>;
  }

  protected get matrixConfig(): MatrixScreenConfig<any> {
    return this.config() as MatrixScreenConfig<any>;
  }
}
