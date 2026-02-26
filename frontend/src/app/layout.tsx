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
      <body className="bg-gray-950 text-white antialiased">{children}</body>
    </html>
  );
}
