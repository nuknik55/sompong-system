// BROWSER ONLY: imported by the print toolbars (client components).

/**
 * Prints once every image on the page has loaded (or failed), so a library
 * image still arriving over its signed link does not print as a blank. Waits
 * at most `timeoutMs`, then prints anyway.
 */
export async function printWhenImagesReady(timeoutMs = 8000): Promise<void> {
  const pending = [...document.images].filter((img) => !img.complete);
  if (pending.length > 0) {
    await Promise.race([
      Promise.all(pending.map((img) => new Promise<void>((resolve) => {
        img.addEventListener("load", () => resolve(), { once: true });
        img.addEventListener("error", () => resolve(), { once: true });
      }))),
      new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
    ]);
  }
  window.print();
}
