/**
 * Web Worker entry: renders a document off the main thread. It builds the same registry as the
 * app (`createRegistry`), so a provider id means the same thing on both sides.
 */
import { createRegistry } from "../../create-registry";
import { runRender, type RenderRequest, type RenderResponse } from "./renderCore";

// The project compiles against the DOM lib, where `self` is a Window. These are the two members
// a dedicated worker scope offers that this file uses.
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<RenderRequest>) => void) | null;
  postMessage(message: RenderResponse): void;
};

const registry = createRegistry();

scope.onmessage = (event) => {
  void runRender(registry, event.data).then((response) => scope.postMessage(response));
};
