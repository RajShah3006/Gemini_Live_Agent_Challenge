import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MathBoard — AI Math Tutor",
  description:
    "Real-time AI math tutor with a digital whiteboard. Speak, upload homework, and watch step-by-step solutions drawn live.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased" style={{ background: "var(--bg-base)", color: "var(--text-primary)" }}>{children}</body>
    </html>
  );
}
