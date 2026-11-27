import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { Amiri, DM_Sans, IBM_Plex_Mono, IBM_Plex_Sans_Arabic, Playfair_Display } from "next/font/google";
import { Footer } from "@/components/Footer";
import { Navbar } from "@/components/Navbar";
import { SkipLink } from "@/components/SkipLink";
import { isLocale, isTheme, LOCALE_COOKIE, localeMeta, negotiateLocale, THEME_COOKIE } from "@/i18n/config";
import { translate } from "@/i18n/translate";
import { Providers } from "./providers";
import "./globals.css";

/** Headlines: high-contrast transitional serif, the voice of the publication. */
const playfair = Playfair_Display({ variable: "--font-playfair", subsets: ["latin"], weight: ["400", "600", "700", "900"], style: ["normal", "italic"] });
/** Interface text: quiet, legible grotesque. */
const dmSans = DM_Sans({ variable: "--font-dmsans", subsets: ["latin"] });
/** Figures, dates, serial numbers. */
const plexMono = IBM_Plex_Mono({ variable: "--font-plexmono", subsets: ["latin"], weight: ["400", "500"] });
/** Arabic headlines: a classic Naskh, the type of the Moroccan Arabic-language press. */
const amiri = Amiri({ variable: "--font-amiri", subsets: ["arabic"], weight: ["400", "700"] });
/** Arabic interface text, drawn as the companion of IBM Plex Mono. */
const plexArabic = IBM_Plex_Sans_Arabic({ variable: "--font-plexarabic", subsets: ["arabic"], weight: ["400", "500", "600", "700"] });

export async function generateMetadata(): Promise<Metadata> {
  const locale = await resolveLocale();
  return { title: translate(locale, "meta.title"), description: translate(locale, "meta.description") };
}

/** Saved choice (cookie) first, then the browser's languages, then French. */
async function resolveLocale() {
  const saved = (await cookies()).get(LOCALE_COOKIE)?.value;
  return isLocale(saved) ? saved : negotiateLocale((await headers()).get("accept-language"));
}

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const locale = await resolveLocale();
  const savedTheme = (await cookies()).get(THEME_COOKIE)?.value;
  const theme = isTheme(savedTheme) ? savedTheme : "system";

  return (
    // "system" sets no data-theme: the CSS media query follows the OS, so there is nothing to flash.
    <html
      lang={locale}
      dir={localeMeta[locale].dir}
      data-theme={theme === "system" ? undefined : theme}
      suppressHydrationWarning
      className={`${playfair.variable} ${dmSans.variable} ${plexMono.variable} ${amiri.variable} ${plexArabic.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col font-sans text-ink">
        <Providers initialLocale={locale} initialTheme={theme}>
          <SkipLink />
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
