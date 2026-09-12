import { Sarabun } from "next/font/google";

/**
 * The ONE print face, shared by all three documents (service sheet, kitchen
 * sheet, quote family). LOADED via next/font rather than merely named in a
 * font-family stack: the app ships only Geist and Kanit, so a named-but-
 * unloaded 'Sarabun' rendered each sheet in whatever the device happened to
 * have — TH SarabunNew on a Thai Windows, a generic sans anywhere else, and
 * the SAME sheet printed differently on different machines. Sarabun is the
 * Thai standard for exactly this kind of paper.
 *
 * Pages pass printFont.className down to their print client; the client
 * applies it on the document wrapper and sets no fontFamily of its own.
 */
export const printFont = Sarabun({ weight: ["400", "500", "700"], subsets: ["thai", "latin"], display: "swap" });
