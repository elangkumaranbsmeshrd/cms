import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { RoleButtonDirective } from './role-button.directive';

/**
 * Regression cover for the accessibility finding that produced this directive:
 * 51 `role="button"` elements across 28 files, none of them reachable by
 * keyboard. See the directive's own doc comment for the full history.
 */
@Component({
  standalone: true,
  imports: [RoleButtonDirective],
  template: `
    <span id="plain" role="button" (click)="hits = hits + 1">Clear all</span>
    <span id="explicit" role="button" tabindex="-1" (click)="hits = hits + 1">Programmatic only</span>
    <span id="disabled" role="button" aria-disabled="true" (click)="hits = hits + 1">Unavailable</span>
    <button id="native" role="button" (click)="hits = hits + 1">Native</button>
    <span id="norole" (click)="hits = hits + 1">Not a button</span>
  `,
})
class HostComponent {
  hits = 0;
}

describe('RoleButtonDirective', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;

  const el = (id: string): HTMLElement => fixture.nativeElement.querySelector(`#${id}`) as HTMLElement;

  const press = (id: string, key: string): void => {
    el(id).dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    fixture.detectChanges();
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [HostComponent] }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('puts a role="button" element into the tab order', () => {
    expect(el('plain').getAttribute('tabindex')).toBe('0');
  });

  it('activates on Enter', () => {
    press('plain', 'Enter');
    expect(host.hits).toBe(1);
  });

  it('activates on Space', () => {
    press('plain', ' ');
    expect(host.hits).toBe(1);
  });

  it('activates on the legacy Spacebar key value', () => {
    press('plain', 'Spacebar');
    expect(host.hits).toBe(1);
  });

  it('prevents the default action so Space does not scroll the page', () => {
    const event = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
    el('plain').dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it('ignores keys that are not Enter or Space', () => {
    press('plain', 'a');
    press('plain', 'Tab');
    press('plain', 'ArrowDown');
    expect(host.hits).toBe(0);
  });

  it('leaves an explicit tabindex alone, so tabindex="-1" still means what it says', () => {
    expect(el('explicit').getAttribute('tabindex')).toBe('-1');
  });

  it('does not fire for a control marked aria-disabled', () => {
    press('disabled', 'Enter');
    expect(host.hits).toBe(0);
  });

  it('does not attach to a native button, which would double-fire its action', () => {
    // The user agent already activates a native button on Enter/Space. If the
    // directive also called .click() the handler would run twice — so the
    // selector excludes them, and no tabindex is stamped on.
    expect(el('native').hasAttribute('tabindex')).toBe(false);
  });

  it('does not touch an element that never claimed to be a button', () => {
    expect(el('norole').hasAttribute('tabindex')).toBe(false);
    press('norole', 'Enter');
    expect(host.hits).toBe(0);
  });
});
