import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Modele variationnel TV — Projet 4",
  description:
    "Debruitage et inpainting d'images par variation totale (Rudin-Osher-Fatemi). Interface de demonstration de l'API.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="fr">
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
