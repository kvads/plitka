export class Requests {
  private sequence = 0;
  private controller: AbortController | null = null;
  cancel() {
    this.sequence++;
    this.controller?.abort();
    this.controller = null;
  }
  start() {
    this.cancel();
    this.controller = new AbortController();
    const seq = this.sequence;
    return {
      signal: this.controller.signal,
      current: () => seq === this.sequence,
    };
  }
}
