import { Directive, ElementRef, HostListener, OnInit, inject } from '@angular/core';

/**
 * Makes every `role="button"` element genuinely operable by keyboard.
 *
 * WHY THIS EXISTS
 * A `<span role="button" (click)="...">` tells a screen reader "this is a
 * button" but is not in the tab order and does not respond to Enter or Space —
 * so a keyboard-only or switch-device user is told an action exists and then
 * cannot reach it. That is worse than an unlabelled control, because the
 * affordance is announced and then denied.
 *
 * An accessibility sweep of this codebase found 51 such elements across 28
 * files, every one of them missing BOTH `tabindex` and a key handler. They sit
 * in list-screen, dashboard-screen, tabbed-screen and sidebar — shared
 * components that render on essentially every screen — so the gap was not
 * localised, it was everywhere.
 *
 * Fixing 51 call sites by hand would fix today and drift tomorrow: the 52nd
 * `role="button"` someone writes would arrive broken again. This directive
 * matches on the role attribute itself, so any element that claims to be a
 * button gets the keyboard contract that claim implies, including ones not
 * written yet.
 *
 * WHAT IT DOES NOT TOUCH
 * `:not(button):not(a)` — native buttons and links already have all of this
 * from the user agent, and calling `.click()` on them from a key handler would
 * fire their action twice.
 *
 * An explicit `tabindex` already on the element is left alone, so a deliberate
 * `tabindex="-1"` (an element meant to be reachable only programmatically)
 * still means what it says.
 */
@Directive({
  selector: '[role="button"]:not(button):not(a)',
  standalone: true,
})
export class RoleButtonDirective implements OnInit {
  private readonly el = inject<ElementRef<HTMLElement>>(ElementRef);

  ngOnInit(): void {
    const node = this.el.nativeElement;
    if (!node.hasAttribute('tabindex')) {
      node.setAttribute('tabindex', '0');
    }
  }

  @HostListener('keydown', ['$event'])
  protected onKeydown(event: KeyboardEvent): void {
    // The WAI-ARIA button pattern requires BOTH keys: Enter activates on
    // keydown, Space on keyup, but activating both on keydown is the common,
    // accepted simplification and is what users actually expect.
    // ' ' is the modern value; 'Spacebar' is the legacy one older engines emit.
    if (event.key !== 'Enter' && event.key !== ' ' && event.key !== 'Spacebar') return;

    // A control that has opted out is announced as unavailable, so it must not
    // fire — the click path gets this for free from CSS pointer-events, the
    // key path does not.
    if (this.el.nativeElement.getAttribute('aria-disabled') === 'true') return;

    // Space scrolls the page by default, and Enter submits an enclosing form.
    // Neither is wanted when the key is activating this control.
    event.preventDefault();

    // Dispatches a real, bubbling click, so the element's own `(click)`
    // binding runs — one activation path, not two implementations to keep
    // in step.
    this.el.nativeElement.click();
  }
}
