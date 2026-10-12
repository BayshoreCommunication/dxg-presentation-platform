export const dynamic = "force-dynamic";

/** The speaker's one guide (D-146): their screen, in their words. */
export default function HelpPage() {
  const steps = [
    "Manage presentations lists every talk you give, grouped by event. Each card shows when and where you present, and where your file is on the way to the room: Upload, Checks, Review, Ready in your room.",
    "To send your slides, drag the file onto the card or press Choose file, check the name and size, then press Submit presentation. PowerPoint (.pptx) is preferred; PDF is accepted; up to 10 GB.",
    "The file is checked automatically in about a minute. If something needs fixing — the slide size, a video format, a file that will not open — the card says what, and you upload a corrected version.",
    "The DXG team reviews it. If they ask for changes, their note appears under your upload; send a new version the same way.",
    "Once approved, the file is set apart on the card with a Download button. Only the approved version can be downloaded — it is exactly what the room will show.",
    "Need to change your slides after approval? Press Upload a new version. Your approved version stays in use until the new one is approved too. After you have signed off onsite in the Speaker Ready Room, the presentation is final and can no longer be replaced here.",
  ];
  return (
    <>
      <h1 className="htitle">Help</h1>
      <p className="note" style={{ marginTop: 0 }}>
        How to send, update and download your presentation, step by step.
      </p>
      <div className="card">
        <div className="chd">
          <h3>Your presentations</h3>
        </div>
        <div className="cbd" style={{ padding: "4px 14px 10px" }}>
          <section className="help-guide">
            <h4 style={{ margin: "12px 0 2px" }}>Upload, update and download your presentation</h4>
            <ol style={{ margin: "6px 0 0", paddingLeft: 20, fontSize: 13.5, lineHeight: 1.55 }}>
              {steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
            <p className="note" style={{ margin: "6px 0 0" }}>
              Tip: if your connection drops during an upload, press Resume — it carries on from where it stopped, never from
              zero.
            </p>
          </section>
        </div>
      </div>
      <p className="note">Still stuck? Ask the DXG team who invited you.</p>
    </>
  );
}
