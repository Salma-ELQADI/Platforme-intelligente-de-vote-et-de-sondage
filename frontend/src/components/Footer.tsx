import Link from "next/link";
import { DoubleRule } from "./decor";

export function Footer() {
  return (
    <footer className="mx-auto mt-20 w-full max-w-6xl px-4 pb-10 sm:px-6">
      <DoubleRule />
      <div className="mt-8 grid gap-8 text-sm sm:grid-cols-3">
        <div>
          <p className="font-serif text-2xl font-black text-ink">VoteLive</p>
          <p className="mt-1 font-arabic text-lg text-umber" lang="ar">صوت الرأي</p>
        </div>
        <nav aria-label="Rubriques">
          <p className="kicker text-umber">Rubriques</p>
          <ul className="mt-3 space-y-1.5">
            <li><Link href="/polls" className="hover:underline">Sondages</Link></li>
            <li><Link href="/polls/new" className="hover:underline">Rédiger un sondage</Link></li>
            <li><Link href="/my-votes" className="hover:underline">Mes votes</Link></li>
          </ul>
        </nav>
        <div>
          <p className="kicker text-umber">Colophon</p>
          <p className="mt-3 leading-relaxed text-umber">
            Composé en Playfair Display, DM Sans et IBM Plex Mono. Résultats calculés en direct à partir des votes enregistrés.
          </p>
        </div>
      </div>
    </footer>
  );
}
