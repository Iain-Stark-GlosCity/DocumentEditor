/**
 * Stops two synced panes from driving each other. Moving one pane makes the other fire a scroll
 * event of its own; without a rule, that event would move the first pane again.
 *
 * Whichever pane the user is scrolling is the master. The other may not drive until the master
 * has been quiet for `windowMs`. Programmatic scrolls caused by the master arrive inside that
 * window and are ignored.
 */
export type Side = "editor" | "preview";

export class SyncGate {
  private master: Side | null = null;
  private until = 0;

  constructor(
    private readonly windowMs = 120,
    private readonly now: () => number = Date.now,
  ) {}

  /** Call on a scroll event. True if that side may move the other one. */
  claim(side: Side): boolean {
    const time = this.now();
    if (this.master !== null && this.master !== side && time < this.until) return false;
    this.master = side;
    this.until = time + this.windowMs;
    return true;
  }

  /** True while `side` may not drive, because the other side is being scrolled. */
  blocked(side: Side): boolean {
    return this.master !== null && this.master !== side && this.now() < this.until;
  }
}
