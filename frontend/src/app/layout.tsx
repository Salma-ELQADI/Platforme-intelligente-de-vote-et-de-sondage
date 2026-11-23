import type { Metadata } from "next";
import { Amiri, DM_Sans, IBM_Plex_Mono, Playfair_Display } from "next/font/google";
import { Footer } from "@/components/Footer";
import { Navbar } from "@/components/Navbar";
import { Providers } from "./providers";
import "./globals.css";

/** Headlines: high-contrast transitional serif, the voice of the publication. */
const playfair = Playfair_Display({ variable: "--font-playfair", subsets: ["latin"], weight: ["400", "600", "700", "900"], style: ["normal", "italic"] });
/** Interface text: quiet, legible grotesque. */
const dmSans = DM_Sans({ variable: "--font-dmsans", subsets: ["latin"] });
/** Figures, dates, serial numbers. */
const plexMono = IBM_Plex_Mono({ variable: "--font-plexmono", subsets: ["latin"], weight: ["400", "500"] });
/** Arabic masthead subtitle, in the tradition of Morocco's bilingual press. */
const amiri = Amiri({ variable: "--font-amiri", subsets: ["arabic"], weight: ["400", "700"] });

export const metadata: Metadata = {
  title: "VoteLive · Le journal des opinions",
  description: "Créez un sondage, votez et suivez les résultats en temps réel. Rédaction assistée par l'IA.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="fr" className={`${playfair.variable} ${dmSans.variable} ${plexMono.variable} ${amiri.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col font-sans text-ink">
        <Providers>
          <a href="#contenu" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:bg-paper focus:px-3 focus:py-2">
            Aller au contenu
          </a>
          <Navbar />
          <main id="contenu" className="mx-auto w-full max-w-6xl flex-1 px-4 py-10 sm:px-6">
            {children}
          </main>
          <Footer />
        </Providers>
      </body>
    </html>
  );
}
