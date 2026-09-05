import assert from "node:assert/strict";
import { test } from "node:test";
import { TouchControls } from "../client/src/touch";
import { Input } from "../client/src/input";
import { Buttons } from "../client/src/sim";

// Only the DOM surface used by TouchControls is stubbed. Real EventTargets
// dispatch the interruption sequences; assertions read the outgoing command.
class Element extends EventTarget {
  classes = new Set<string>();
  classList = {
    add: (name: string) => { this.classes.add(name); },
    remove: (name: string) => { this.classes.delete(name); },
    toggle: (name: string, force: boolean) => {
      if (force) this.classes.add(name); else this.classes.delete(name);
    },
  };
  style = { left: "", top: "", transform: "" };
  dataset: Record<string, string> = {};
  textContent = "";
  children = new Map<string, Element>();
  querySelector(selector: string) { return this.children.get(selector); }
  querySelectorAll(selector: string) {
    return [...this.children.values()].filter((el) =>
      selector === "button" ? el.dataset.act : el.classes.has("on"));
  }
  getBoundingClientRect() { return { left: 0, top: 0, width: 400, height: 600 }; }
  setPointerCapture(_id: number) {}
}

function pointer(el: Element, type: string, id: number, x = 180, y = 350): void {
  const event = new Event(type, { cancelable: true });
  Object.assign(event, { pointerId: id, clientX: x, clientY: y });
  el.dispatchEvent(event);
}

function setup() {
  const root = new Element();
  for (const name of [".pad.move", ".pad.look", ".stick", ".knob", ".weapon"]) {
    root.children.set(name, new Element());
  }
  for (const action of ["fire", "jump", "reload", "zoom", "duck", "weapon", "menu"]) {
    const button = action === "weapon" ? root.querySelector(".weapon")! : new Element();
    button.dataset.act = action;
    root.children.set(action === "weapon" ? ".weapon" : action, button);
  }
  const doc = Object.assign(new EventTarget(), {
    body: new Element(), hidden: false, getElementById: () => root,
  });
  const win = new EventTarget();
  Object.assign(globalThis, { document: doc, window: win, location: new URL("http://localhost/?touch") });
  const looks: number[][] = [];
  const controls = new TouchControls((x, y) => looks.push([x, y]), () => controls.setVisible(false));
  const input = new Input(root as unknown as HTMLElement);
  input.touch = controls;
  controls.setVisible(true);
  const move = root.querySelector(".pad.move")!;
  const look = root.querySelector(".pad.look")!;
  const drag = (id: number) => {
    pointer(move, "pointerdown", id);
    pointer(move, "pointermove", id, 100, 270);
    const command = input.sample();
    assert.ok(command.forward > 0 && command.strafe < 0, "moving diagonally forward-left");
  };
  const stopped = () => {
    const command = input.sample();
    assert.equal(command.forward, 0);
    assert.equal(command.strafe, 0);
    assert.equal(root.querySelector(".knob")!.style.transform, "");
    assert.equal(root.querySelector(".stick")!.classes.has("live"), false);
    return command;
  };
  return { root, controls, input, doc, win, looks, move, look, drag, stopped };
}

for (const end of ["pointerup", "pointercancel", "lostpointercapture"]) {
  test(`movement stops on ${end} and accepts a fresh finger`, () => {
    const f = setup();
    f.drag(1);
    pointer(f.move, end, 1);
    f.stopped();
    pointer(f.move, "pointermove", 1, 0, 0); // late event from the cancelled drag
    f.stopped();
    f.drag(2);
    pointer(f.move, "pointerup", 1);
    assert.ok(f.input.sample().forward > 0, "late release cannot stop the new finger");
    pointer(f.move, "pointerup", 2);
    f.stopped();
  });
}

test("ending the look finger does not release the movement finger", () => {
  const f = setup();
  f.drag(1);
  pointer(f.look, "pointerdown", 2);
  pointer(f.look, "pointermove", 2, 200, 360);
  pointer(f.look, "lostpointercapture", 2);
  pointer(f.move, "lostpointercapture", 2);
  assert.ok(f.input.sample().forward > 0);
  pointer(f.look, "pointerdown", 3);
  pointer(f.look, "pointermove", 3, 220, 365);
  assert.deepEqual(f.looks, [[20, 10], [40, 15]]);
});

for (const interruption of ["blur", "pagehide", "visibilitychange", "resize", "menu"]) {
  test(`${interruption} clears movement, held actions and queued weapons`, () => {
    const f = setup();
    f.drag(1);
    pointer(f.look, "pointerdown", 2);
    pointer(f.root.querySelector("fire")!, "pointerdown", 3);
    pointer(f.root.querySelector("duck")!, "pointerdown", 4);
    pointer(f.root.querySelector(".weapon")!, "pointerdown", 5);
    if (interruption === "menu") f.controls.setVisible(false);
    else if (interruption === "visibilitychange") {
      f.doc.hidden = true;
      f.doc.dispatchEvent(new Event(interruption));
    } else f.win.dispatchEvent(new Event(interruption));
    const command = f.stopped();
    assert.equal(command.buttons, 0);
    assert.equal(command.weapon, 0);
    assert.equal(f.root.querySelectorAll(".on").length, 0);
    pointer(f.look, "pointermove", 2, 0, 0);
    assert.deepEqual(f.looks, []);
    f.doc.hidden = false;
    f.controls.setVisible(true);
    f.drag(6);
    pointer(f.look, "pointerdown", 7);
    pointer(f.look, "pointermove", 7, 200, 355);
    assert.deepEqual(f.looks, [[20, 5]]);
  });
}

test("capture loss releases a held action without clearing crouch", () => {
  const f = setup();
  pointer(f.root.querySelector("fire")!, "pointerdown", 1);
  pointer(f.root.querySelector("duck")!, "pointerdown", 2);
  pointer(f.root.querySelector("fire")!, "lostpointercapture", 1);
  assert.equal(f.input.sample().buttons, Buttons.duck);
});

test("a second finger and a visible-page notification leave an active drag alone", () => {
  const f = setup();
  f.drag(1);
  pointer(f.move, "pointerdown", 2);
  pointer(f.move, "pointermove", 2, 300, 450);
  pointer(f.move, "pointercancel", 2);
  f.doc.dispatchEvent(new Event("visibilitychange"));
  const command = f.input.sample();
  assert.ok(command.forward > 0 && command.strafe < 0);
});
