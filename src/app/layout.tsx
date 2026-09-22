import type { Metadata, Viewport } from "next";
import { Geist_Mono, Kanit, Montserrat, Noto_Sans_Thai } from "next/font/google";
import "./globals.css";

// THE APP'S FACES (AGENTS.md, "The app's look"). All loaded here through
// next/font, which self-hosts them: no request to a font CDN at run time.
//
// Body text and tables: Noto Sans Thai, Thai and Latin. Its digits are
// tabular, so amounts line up in a column. Kanit's are NOT: with
// tabular-nums on, "111,111.11" measured 33px against 61px for "888,888.88"
// (2026-09-22), so Kanit cannot set a column of figures.
const bodyFont = Noto_Sans_Thai({
  subsets: ["thai", "latin"],
  variable: "--font-body",
});

// Headings and buttons: Kanit, the brand's Thai face (Light, Medium, Bold in
// the guideline; 400 and 600 stay because 72 existing font-kanit headings use
// them). Montserrat, the brand's English face, sets the Latin letters and
// digits beside it (font-heading in globals.css).
const kanit = Kanit({
  weight: ["300", "400", "500", "600", "700"],
  subsets: ["thai", "latin"],
  variable: "--font-kanit",
});

const montserrat = Montserrat({
  subsets: ["latin"],
  variable: "--font-montserrat",
});

// font-mono, 14 uses.
const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "สมพงศ์ ซีฟู้ด",
  description: "ระบบต้นทุนอาหารและ Menu Engineering",
};

export const viewport: Viewport = {
  colorScheme: "light",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="th"
      className={`${bodyFont.variable} ${kanit.variable} ${montserrat.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-neutral-50">{children}</body>
    </html>
  );
}
