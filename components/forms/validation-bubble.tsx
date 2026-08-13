"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertCircle } from "lucide-react";
import { useTranslations } from "next-intl";

// The browser's own validation bubble ("Please fill out this field.") is OS
// chrome: unstyleable, English regardless of the app locale, and jarring against
// a dark Thai UI. It cannot be restyled — only suppressed. So this listens for
// `invalid` at the document (capture phase; the event does not bubble),
// preventDefault()s the native bubble, and renders a themed one in its place for
// every form in the app at once. No form has to opt in, and `required` /
// `pattern` / `minLength` keep working exactly as before.
//
// Canceling the invalid event also cancels the UA's own "focus the first invalid
// control" behaviour, so this does that part itself.

type Bubble = { top: number; left: number; message: string };

const MAX_WIDTH = 280;
const DISMISS_MS = 6000;

type Validatable = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

const isValidatable = (el: EventTarget | null): el is Validatable =>
  el instanceof HTMLInputElement ||
  el instanceof HTMLSelectElement ||
  el instanceof HTMLTextAreaElement;

/** The visible label for a control, so the message can name the field. */
function labelFor(el: Validatable): string | null {
  const aria = el.getAttribute("aria-label");
  if (aria) return aria.trim();
  if (el.id) {
    const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
    // Labels carry a "*" marker for required fields — not part of the name.
    const text = label?.textContent?.replace(/\*/g, "").trim();
    if (text) return text;
  }
  return null;
}

export function ValidationBubble() {
  const t = useTranslations("validation");
  const [bubble, setBubble] = useState<Bubble | null>(null);
  const targetRef = useRef<Validatable | null>(null);
  const messageRef = useRef<string>("");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dismiss = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    targetRef.current?.removeAttribute("aria-invalid");
    targetRef.current = null;
    setBubble(null);
  }, []);

  // Anchored under the control. Called again on scroll/resize so the bubble
  // tracks its field instead of being orphaned — the smooth scroll below emits
  // scroll events of its own, so "dismiss on scroll" would kill it instantly.
  const place = useCallback(() => {
    const el = targetRef.current;
    if (!el) return;
    if (!el.isConnected) return dismiss();
    const rect = el.getBoundingClientRect();
    setBubble({
      top: rect.bottom + 8,
      left: Math.min(Math.max(8, rect.left), Math.max(8, window.innerWidth - MAX_WIDTH - 8)),
      message: messageRef.current,
    });
  }, [dismiss]);

  // ValidityState → a translated sentence. Falls back to the browser's own text
  // for the exotic states rather than inventing a vague one.
  const messageFor = useCallback(
    (el: Validatable): string => {
      const v = el.validity;
      const name = labelFor(el);
      const type = el instanceof HTMLInputElement ? el.type : "";
      if (v.valueMissing) {
        if (type === "checkbox" || type === "radio") return t("requiredChoice");
        if (el instanceof HTMLSelectElement) return t("requiredSelect");
        return name ? t("requiredNamed", { field: name }) : t("required");
      }
      if (v.typeMismatch) {
        if (type === "email") return t("email");
        if (type === "url") return t("url");
        return t("invalid");
      }
      // A pattern's `title` is the author's own explanation — better than ours.
      if (v.patternMismatch) return el.title.trim() || t("pattern");
      if (v.tooShort && el instanceof HTMLInputElement) return t("tooShort", { min: el.minLength });
      if (v.tooLong && el instanceof HTMLInputElement) return t("tooLong", { max: el.maxLength });
      if (v.rangeUnderflow && el instanceof HTMLInputElement) return t("rangeUnderflow", { min: el.min });
      if (v.rangeOverflow && el instanceof HTMLInputElement) return t("rangeOverflow", { max: el.max });
      if (v.stepMismatch) return t("step");
      if (v.badInput) return t("badInput");
      return el.validationMessage;
    },
    [t],
  );

  useEffect(() => {
    // `invalid` fires once per invalid control, in document order. The native UI
    // only ever reports the first one, and so do we — the rest would stack at
    // unrelated scroll positions.
    let claimedThisPass = false;
    let raf = 0;

    const onInvalid = (e: Event) => {
      const el = e.target;
      if (!isValidatable(el)) return;
      e.preventDefault(); // suppress the native bubble
      if (claimedThisPass) return;
      claimedThisPass = true;
      queueMicrotask(() => {
        claimedThisPass = false;
      });

      messageRef.current = messageFor(el);
      targetRef.current = el;
      el.setAttribute("aria-invalid", "true");
      // A control below the fold is why a failed submit could look like nothing
      // happened at all — bring it into view, then anchor to it.
      el.focus({ preventScroll: true });
      el.scrollIntoView({ block: "center", behavior: "smooth" });
      place();

      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(dismiss, DISMISS_MS);
    };

    const reposition = () => {
      if (!targetRef.current) return;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(place);
    };

    // Any correction retires the message; Escape and a click elsewhere dismiss it.
    const onInput = (e: Event) => {
      if (e.target === targetRef.current) dismiss();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismiss();
    };
    const onPointer = (e: Event) => {
      if (targetRef.current && e.target !== targetRef.current) dismiss();
    };

    document.addEventListener("invalid", onInvalid, true);
    document.addEventListener("input", onInput, true);
    document.addEventListener("change", onInput, true);
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", onPointer, true);
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      document.removeEventListener("invalid", onInvalid, true);
      document.removeEventListener("input", onInput, true);
      document.removeEventListener("change", onInput, true);
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("pointerdown", onPointer, true);
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
      cancelAnimationFrame(raf);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [dismiss, messageFor, place]);

  if (!bubble) return null;

  return createPortal(
    <div
      role="alert"
      aria-live="assertive"
      style={{ top: bubble.top, left: bubble.left, maxWidth: MAX_WIDTH }}
      className="pointer-events-none fixed z-60 flex items-start gap-2 rounded-md border border-destructive/40 bg-popover px-3 py-2 text-xs font-medium text-destructive shadow-lg"
    >
      <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
      <span>{bubble.message}</span>
    </div>,
    document.body,
  );
}
