import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Meme Wars Arena",
  description: "A 90-second meme battle and virtual market game.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
