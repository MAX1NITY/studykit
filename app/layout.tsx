import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

/*
  Two faces, doing clearly different jobs.

  IBM Plex Sans runs the interface: it has an engineered, instructional
  quality that suits status lines and controls. Newsreader is the reading
  face, used for anything meant to be read and thought about — the question
  being asked, your answer, the marking, the guide.

  Both are self-hosted variable fonts (see ./fonts/README.md), so no request
  leaves for a font CDN and the build has no external dependency.
*/

const plex = localFont({
  variable: "--font-plex",
  display: "swap",
  src: [
    {
      path: "./fonts/ibm-plex-sans-latin-wght-normal.woff2",
      weight: "100 700",
      style: "normal",
    },
  ],
});

const newsreader = localFont({
  variable: "--font-newsreader",
  display: "swap",
  src: [
    {
      path: "./fonts/newsreader-latin-wght-normal.woff2",
      weight: "200 800",
      style: "normal",
    },
    {
      path: "./fonts/newsreader-latin-wght-italic.woff2",
      weight: "200 800",
      style: "italic",
    },
  ],
});

export const metadata: Metadata = {
  title: "StudyKit",
  description:
    "Turn your own notes into questions that get harder as you learn them.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${plex.variable} ${newsreader.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
