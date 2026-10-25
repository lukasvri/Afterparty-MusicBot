import type { Metadata } from "next";
import { LanguageProvider } from "@/components/language";
import { ErrorReporting } from "@/components/error-reporting";
import "./globals.css";
import "./concert.css";
import "./party.css";
import "./guess.css";
import "./social.css";
import "./interface.css";
import "./discovery.css";
import "./library.css";
export const metadata: Metadata = {
  title: "Afterparty",
  description: "Find music, share video rooms and follow the music from Discord.",
  icons: { icon: "/favicon.svg" },
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="referrer" content="strict-origin-when-cross-origin" />
      </head>
      <body>
        <ErrorReporting />
        <LanguageProvider>{children}</LanguageProvider>
      </body>
    </html>
  );
}
