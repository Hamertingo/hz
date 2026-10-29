declare module "@novnc/novnc" {
  export default class RFB extends EventTarget {
    constructor(target: HTMLElement, url: string, options?: { shared?: boolean; credentials?: { password?: string } });
    scaleViewport: boolean;
    resizeSession: boolean;
    clipViewport: boolean;
    showDotCursor: boolean;
    background: string;
    qualityLevel: number;
    compressionLevel: number;
    viewOnly: boolean;
    focus(): void;
    blur(): void;
    disconnect(): void;
  }
}
