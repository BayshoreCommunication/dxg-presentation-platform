/**
 * The playback driver: the one seam between the Room Agent and whatever actually shows a
 * presentation (BUILD_SPEC §9, D-002). G0-1 tests two real implementations against the same
 * contract — PowerPoint over COM inside the agent, and PowerPoint over COM in a separate
 * helper process — and the evidence decides the default. A fake implements it for tests.
 */

export type ShowRequest = {
  /** Absolute path to the verified local copy. */
  file: string;
  /** 1-based monitor number as Windows numbers them (\\.\DISPLAY<n>). */
  monitor: number;
  presenterView: boolean;
  /** Correlates the launch across logs and evidence. */
  launchId: string;
};

export type ShowStatus = {
  /** A slideshow window exists and PowerPoint answered. */
  running: boolean;
  /** PowerPoint (or the helper) answered within the status timeout. */
  responsive: boolean;
  slide?: number;
  pid?: number;
  /** Where the slideshow window is, for monitor-targeting evidence (G0-1 item 3). */
  window?: { left: number; top: number; width: number; height: number };
};

export type DriverEvent =
  /** The show ended on its own (last slide, Esc). */
  | { kind: "ended" }
  /** PowerPoint or the helper process died or stopped answering. */
  | { kind: "crashed"; detail: string };

export interface PlaybackDriver {
  readonly name: "com" | "helper" | "fake";
  /** Opens the file and starts the slideshow; resolves once the first slide is showing. */
  start(request: ShowRequest): Promise<{ firstSlideMs: number; pid?: number }>;
  status(): Promise<ShowStatus>;
  /** Ends the slideshow and closes the presentation, leaving PowerPoint running. */
  stop(): Promise<void>;
  /** Quits PowerPoint entirely (after a failure, or on agent shutdown). */
  shutdown(): Promise<void>;
  onEvent(listener: (event: DriverEvent) => void): () => void;
}

/** Thrown for a failure that has a clear reason a technician can act on. */
export class PlaybackError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

/** File types PowerPoint plays; others go through the media path (PDF, video, image). */
export const POWERPOINT_TYPES = [".pptx", ".ppt", ".pptm", ".ppsx", ".pps"];
export const MEDIA_TYPES = [".pdf", ".mp4", ".mov", ".m4v", ".png", ".jpg", ".jpeg"];
