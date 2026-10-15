import type { Metadata } from "next";
import { LanguageProvider } from "@/components/language";
import "./globals.css";
import "./concert.css";
import "./interface.css";
import "./party.css";
export const metadata: Metadata = {
  title: "Afterparty",
  description: "Søk etter musikk, del videorom og følg musikken fra Discord.",
  icons: { icon: "/favicon.svg" },
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="nb">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="referrer" content="strict-origin-when-cross-origin" />
      </head>
      <body>
        <LanguageProvider>{children}</LanguageProvider>
      </body>
    </html>
  );
}
