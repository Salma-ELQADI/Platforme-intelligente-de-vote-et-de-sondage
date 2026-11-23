import { ButtonLink } from "@/components/ui";
import { DoubleRule } from "@/components/decor";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-2xl py-16 text-center">
      <DoubleRule />
      <p className="kicker mt-6 text-umber">Erratum</p>
      <p className="mt-3 font-mono text-7xl text-ink">404</p>
      <h1 className="mt-4 font-serif text-4xl font-black text-ink">Cette page n’a jamais été imprimée.</h1>
      <p className="mt-3 font-serif text-lg italic text-umber">L’adresse demandée ne correspond à aucune page de VoteLive.</p>
      <ButtonLink href="/" className="mt-8">Retour à la une</ButtonLink>
    </div>
  );
}
