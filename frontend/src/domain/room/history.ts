import type { RoomState } from "../project/schema";
export class History {
  private items: RoomState[] = [];
  push(r: RoomState) {
    this.items.push(structuredClone(r));
    if (this.items.length > 20) this.items.shift();
  }
  pop() {
    return this.items.pop();
  }
  get length() {
    return this.items.length;
  }
}
