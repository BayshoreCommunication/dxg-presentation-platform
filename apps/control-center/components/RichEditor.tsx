"use client";

import "quill/dist/quill.snow.css";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import type Quill from "quill";

export type RichEditorHandle = {
  /** Puts text (a `{{field}}`) where the cursor is, or at the end. */
  insertText: (text: string) => void;
};

/**
 * The email message editor (D-139): Quill, the editor Preseria uses, with the same toolbar —
 * font, size, bold / italic / underline / strike, text and highlight colour, superscript and
 * subscript, numbered and bulleted lists, alignment, link, image, clear formatting — and a
 * character counter.
 *
 * Every format is written as an inline style (font-family, font-size, text-align, colour),
 * never as a class: mail clients drop stylesheets, so a class would arrive unformatted.
 * Images are uploaded (`onImage`) and placed by their web address — a pasted-in image is
 * shown by almost no mail client. The server cleans whatever this produces (D-139).
 */
export const RichEditor = forwardRef<
  RichEditorHandle,
  {
    initialHtml: string;
    onChange: (html: string, text: string) => void;
    onImage: (file: File) => Promise<string>;
    maxChars: number;
    label: string;
  }
>(function RichEditor({ initialHtml, onChange, onImage, maxChars, label }, ref) {
  const host = useRef<HTMLDivElement>(null);
  const quill = useRef<Quill | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [count, setCount] = useState(0);
  const [imageError, setImageError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  // The callbacks change on every render; the editor is built once.
  const latest = useRef({ onChange, onImage });
  latest.current = { onChange, onImage };

  useImperativeHandle(ref, () => ({
    insertText(text: string) {
      const editor = quill.current;
      if (!editor) return;
      const range = editor.getSelection(true) ?? { index: editor.getLength() - 1, length: 0 };
      editor.deleteText(range.index, range.length, "user");
      editor.insertText(range.index, text, "user");
      editor.setSelection(range.index + text.length, 0, "user");
    },
  }));

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { default: QuillClass } = await import("quill");
      if (cancelled || !host.current || quill.current) return;

      // Inline styles, not classes — see above.
      const Font = QuillClass.import("attributors/style/font") as { whitelist: string[] };
      Font.whitelist = ["serif", "monospace"];
      QuillClass.register(Font as never, true);
      const Size = QuillClass.import("attributors/style/size") as { whitelist: string[] };
      Size.whitelist = ["12px", "18px", "24px"];
      QuillClass.register(Size as never, true);
      QuillClass.register(QuillClass.import("attributors/style/align") as never, true);

      const editor = new QuillClass(host.current, {
        theme: "snow",
        modules: {
          toolbar: {
            container: [
              [{ font: [false, "serif", "monospace"] }, { size: ["12px", false, "18px", "24px"] }],
              ["bold", "italic", "underline", "strike"],
              [{ color: [] }, { background: [] }],
              [{ script: "super" }, { script: "sub" }],
              [{ list: "ordered" }, { list: "bullet" }],
              [{ align: [] }],
              ["link", "image"],
              ["clean"],
            ],
            handlers: { image: () => fileInput.current?.click() },
          },
        },
      });
      editor.root.setAttribute("aria-label", label);
      editor.setContents(editor.clipboard.convert({ html: initialHtml }), "silent");

      const report = () => {
        // Quill 2 writes every space as &nbsp;, which would stop lines wrapping in the email.
        const html = editor.getSemanticHTML().replace(/&nbsp;/g, " ");
        const text = editor.getText().replace(/\n$/, "");
        setCount(text.length);
        latest.current.onChange(html, text);
      };
      editor.on("text-change", report);
      quill.current = editor;
      report();
    })();
    return () => {
      cancelled = true;
    };
    // Built once per mount; a different template remounts it (keyed by the caller).
  }, []);

  async function placeImage(file: File) {
    const editor = quill.current;
    if (!editor) return;
    setUploading(true);
    setImageError(null);
    try {
      const url = await latest.current.onImage(file);
      const range = editor.getSelection(true) ?? { index: editor.getLength() - 1, length: 0 };
      editor.insertEmbed(range.index, "image", url, "user");
      editor.setSelection(range.index + 1, 0, "user");
    } catch (caught) {
      setImageError(caught instanceof Error ? caught.message : "The image could not be added.");
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  return (
    <div className="rich-editor">
      <input
        ref={fileInput}
        type="file"
        accept="image/png,image/jpeg,image/gif"
        style={{ display: "none" }}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void placeImage(file);
        }}
      />
      <div ref={host} />
      <div className="rich-foot">
        <span className="note">
          {uploading ? "Adding the image…" : imageError ? <span style={{ color: "var(--block)" }}>{imageError}</span> : null}
        </span>
        <span className={count > maxChars ? "rich-count over" : "rich-count"}>
          {count.toLocaleString("en-US")} / {maxChars.toLocaleString("en-US")}
        </span>
      </div>
    </div>
  );
});
