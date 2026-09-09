/**
 * The revenue-import screen's state machine, extracted so the one transition
 * that failed in production can be tested.
 *
 * ── WHAT FAILED, AND WHY IT IS HELD IN STATE NOW ──────────────────────────
 *
 * The first real run read the file for `apply` from the DOM input:
 * `fileRef.current.files[0]`. It was empty. React 19 resets an uncontrolled
 * form after a `<form action={fn}>` submission completes — react-dom's
 * startHostTransition wraps the action as `requestFormReset(form); action()`
 * — so the preview submission itself cleared the input, and apply then found
 * nothing to send. Every render between preview and apply is another chance
 * for the DOM to differ from what the user last chose.
 *
 * So the File is captured into state at the moment it is selected, and apply
 * submits THAT. The input is only ever how a file gets into state; it is never
 * read back.
 *
 * ── THE INVARIANT ─────────────────────────────────────────────────────────
 *
 * `canApply` is true only when the held file IS the file the preview was
 * built from. Choosing a different file after a preview drops the preview,
 * so there is no state in which a new file could be applied against an old
 * preview's numbers. The server re-parses and echo-checks the month and gross
 * regardless — this is the client-side half of the same guard, not a
 * replacement for it.
 *
 * Generic over the file type and the preview type so it runs under
 * `node --test` with plain objects, with no DOM and no server imports.
 */

export type ImportState<F, P extends { blocks: readonly unknown[] }, R> = {
  /** The file the user last chose. The only source apply ever reads. */
  file: F | null;
  preview: P | null;
  /** The file `preview` was computed from. Compared by identity to `file`. */
  previewedFile: F | null;
  error: string | null;
  applied: R | null;
};

export type ImportAction<F, P, R> =
  | { type: "select-file"; file: F | null }
  | { type: "preview-start" }
  | { type: "preview-ok"; preview: P; file: F }
  | { type: "preview-failed"; error: string }
  | { type: "apply-start" }
  | { type: "apply-ok"; result: R }
  | { type: "apply-failed"; error: string };

export function initialImportState<F, P extends { blocks: readonly unknown[] }, R>(): ImportState<F, P, R> {
  return { file: null, preview: null, previewedFile: null, error: null, applied: null };
}

export function importReducer<F, P extends { blocks: readonly unknown[] }, R>(
  state: ImportState<F, P, R>,
  action: ImportAction<F, P, R>,
): ImportState<F, P, R> {
  switch (action.type) {
    case "select-file":
      // A new choice invalidates everything derived from the old one. The
      // preview is dropped rather than kept "for reference": a visible preview
      // beside an enabled apply button IS the claim that they belong together.
      return { file: action.file, preview: null, previewedFile: null, error: null, applied: null };

    case "preview-start":
      return { ...state, preview: null, previewedFile: null, error: null, applied: null };

    case "preview-ok":
      // Recorded against the file it came from, not against state.file — if
      // the user changed files while the preview was in flight, the two
      // differ and canApply stays false.
      return { ...state, preview: action.preview, previewedFile: action.file, error: null };

    case "preview-failed":
      return { ...state, preview: null, previewedFile: null, error: action.error };

    case "apply-start":
      return { ...state, error: null, applied: null };

    case "apply-ok":
      // The preview's "current" column is now stale by exactly what was
      // written. Drop it so a re-run has to re-read and show the new state
      // before it can be confirmed; the file stays so that is one click.
      return { ...state, applied: action.result, preview: null, previewedFile: null };

    case "apply-failed":
      return { ...state, error: action.error, applied: null };
  }
}

/** Apply may run only against the exact file the preview was built from, with nothing blocking. */
export function canApply<F, P extends { blocks: readonly unknown[] }, R>(s: ImportState<F, P, R>): boolean {
  return (
    s.file !== null &&
    s.preview !== null &&
    s.previewedFile === s.file &&
    s.preview.blocks.length === 0
  );
}
