export class InputManager {
  keys = new Set<string>();
  mouseDown = false;
  mouseDX = 0;
  mouseDY = 0;

  constructor() {
    document.addEventListener("keydown", (e) => this.keys.add(e.code));
    document.addEventListener("keyup", (e) => this.keys.delete(e.code));
    document.addEventListener("mousedown", (e) => {
      if (e.button === 0) this.mouseDown = true;
    });
    document.addEventListener("mouseup", (e) => {
      if (e.button === 0) this.mouseDown = false;
    });
    document.addEventListener("mousemove", (e) => {
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });
  }

  consumeMouse(): { dx: number; dy: number } {
    const dx = this.mouseDX;
    const dy = this.mouseDY;
    this.mouseDX = 0;
    this.mouseDY = 0;
    return { dx, dy };
  }
}
