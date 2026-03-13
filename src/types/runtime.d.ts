interface HTMLRewriterElement {
  getAttribute(name: string): string | null;
  onEndTag(handler: () => void): void;
}

interface HTMLRewriterTextChunk {
  text: string;
  lastInTextNode: boolean;
}

interface HTMLRewriterHandlers {
  element?(element: HTMLRewriterElement): void;
  text?(text: HTMLRewriterTextChunk): void;
}

declare class HTMLRewriter {
  on(selector: string, handlers: HTMLRewriterHandlers): this;
  transform(response: Response): Response;
}
